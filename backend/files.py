from __future__ import annotations

import os
import shutil
import secrets
import zipfile
import tarfile
from pathlib import Path
from typing import List, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .models import PublicLink, User


router = APIRouter(prefix="/files", tags=["files"])


STORAGE_ROOT = Path("./storage").resolve()
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


class FileItem(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int
    modified_at: float


class FileListResponse(BaseModel):
    current_path: str
    items: List[FileItem]


class CreateFolderRequest(BaseModel):
    path: str = ""
    name: str


class DeleteRequest(BaseModel):
    path: str


class RenameRequest(BaseModel):
    old_path: str
    new_name: str


class MoveRequest(BaseModel):
    source_path: str
    target_dir: str = ""


class UnarchiveRequest(BaseModel):
    path: str
    mode: Literal["same_folder", "new_subfolder"] = "new_subfolder"


class ShareResponse(BaseModel):
    url: str  # backward compatible: direct link
    token: str
    direct_url: str
    page_url: str
    exists: bool = False  # True if link already existed


class ShareStatusResponse(BaseModel):
    has_link: bool
    token: str | None = None
    direct_url: str | None = None
    page_url: str | None = None


def _normalize_relative(path: str | None) -> str:
    if not path:
        return ""
    # Normalize separators and remove leading slashes
    normalized = path.replace("\\", "/").lstrip("/")
    if normalized == ".":
        return ""
    return normalized


def safe_join(relative_path: str) -> Path:
    """
    Join a user-provided relative path with STORAGE_ROOT and ensure
    that the result stays inside STORAGE_ROOT to prevent path traversal.
    """
    rel = _normalize_relative(relative_path)
    full_path = (STORAGE_ROOT / rel).resolve()
    try:
        full_path.relative_to(STORAGE_ROOT)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid path",
        )
    return full_path


def _ensure_within_storage(path: Path) -> None:
    try:
        path.resolve().relative_to(STORAGE_ROOT)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path escapes storage root",
        )


def _relative_from_storage(path: Path) -> str:
    return str(path.resolve().relative_to(STORAGE_ROOT)).replace("\\", "/")


def _non_conflicting_path(target: Path) -> Path:
    """
    If target exists, add numeric suffix before the extension to avoid overwriting.
    """
    if not target.exists():
        return target

    stem = target.stem
    suffix = target.suffix
    parent = target.parent
    counter = 1
    while True:
        candidate = parent / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


@router.get("/list", response_model=FileListResponse)
async def list_files(
    path: str = "",
    user: User = Depends(get_current_user),
) -> FileListResponse:
    rel = _normalize_relative(path)
    directory = safe_join(rel)

    if not directory.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Path not found")
    if not directory.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a directory")

    items: List[FileItem] = []
    for entry in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        stat = entry.stat()
        items.append(
            FileItem(
                name=entry.name,
                path=_relative_from_storage(entry),
                is_dir=entry.is_dir(),
                size=0 if entry.is_dir() else stat.st_size,
                modified_at=stat.st_mtime,
            )
        )

    return FileListResponse(current_path=rel, items=items)


@router.post("/folder")
async def create_folder(
    payload: CreateFolderRequest,
    user: User = Depends(get_current_user),
) -> dict:
    base_dir = safe_join(payload.path)
    if not base_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Base path not found")
    if not base_dir.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Base path is not a directory")

    new_dir = base_dir / payload.name
    _ensure_within_storage(new_dir)
    new_dir.mkdir(parents=False, exist_ok=False)
    return {"detail": "folder created"}


@router.post("/upload")
async def upload_files(
    path: str = Form(""),
    files: List[UploadFile] = File(...),
    user: User = Depends(get_current_user),
) -> dict:
    target_dir = safe_join(path)
    if not target_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target path not found")
    if not target_dir.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target path is not a directory")

    saved_files: List[str] = []
    for upload in files:
        filename = os.path.basename(upload.filename)
        dest = target_dir / filename
        dest = _non_conflicting_path(dest)
        _ensure_within_storage(dest)

        with dest.open("wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)
        saved_files.append(_relative_from_storage(dest))

    return {"detail": "files uploaded", "files": saved_files}


@router.delete("/delete")
async def delete_path(
    payload: DeleteRequest,
    user: User = Depends(get_current_user),
) -> dict:
    target = safe_join(payload.path)
    if not target.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Path not found")

    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()

    return {"detail": "deleted"}


@router.post("/rename")
async def rename_path(
    payload: RenameRequest,
    user: User = Depends(get_current_user),
) -> dict:
    old = safe_join(payload.old_path)
    if not old.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source path not found")

    # Build new relative path inside the same parent directory
    old_rel = Path(_normalize_relative(payload.old_path))
    parent_rel = old_rel.parent
    new_rel = (parent_rel / payload.new_name).as_posix()
    new_path = safe_join(new_rel)

    if new_path.exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target already exists")

    _ensure_within_storage(new_path)
    old.rename(new_path)

    return {"detail": "renamed"}


@router.post("/move")
async def move_path(
    payload: MoveRequest,
    user: User = Depends(get_current_user),
) -> dict:
    src = safe_join(payload.source_path)
    if not src.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source path not found",
        )

    dst_dir = safe_join(payload.target_dir)
    if not dst_dir.exists() or not dst_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target directory not found",
        )

    dst = dst_dir / src.name
    _ensure_within_storage(dst)

    # Запрет перемещения папки в саму себя или внутрь своего потомка
    if src.is_dir():
        try:
            dst.resolve().relative_to(src.resolve())
        except ValueError:
            pass
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move folder into itself or its subfolder",
            )

    if dst.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Destination already exists",
        )

    src.rename(dst)
    return {"detail": "moved"}


@router.post("/unarchive")
async def unarchive_file(
    payload: UnarchiveRequest,
    user: User = Depends(get_current_user),
) -> dict:
    archive_path = safe_join(payload.path)
    if not archive_path.exists() or not archive_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Archive not found",
        )

    lower_name = archive_path.name.lower()
    archive_type = None

    if lower_name.endswith(".zip"):
        archive_type = "zip"
    elif lower_name.endswith((".tar.gz", ".tgz")):
        archive_type = "tar_gz"
    elif lower_name.endswith(".tar"):
        archive_type = "tar"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported archive format. Supported: .zip, .tar, .tar.gz, .tgz",
        )

    target_base_dir = archive_path.parent

    if payload.mode == "new_subfolder":
        target_dir = target_base_dir / archive_path.stem
        if target_dir.exists() and not target_dir.is_dir():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Target path exists and is not a directory",
            )
        target_dir.mkdir(parents=False, exist_ok=True)
    else:
        target_dir = target_base_dir

    _ensure_within_storage(target_dir)

    # Безопасное извлечение архива
    if archive_type == "zip":
        with zipfile.ZipFile(archive_path) as zf:
            # Проверяем все пути на безопасность
            for member in zf.infolist():
                member_name = member.filename
                # Нормализуем путь (убираем ведущие / и ..)
                if not member_name or member_name.startswith(("/", "\\")):
                    member_name = member_name.lstrip("/\\")
                if ".." in member_name or member_name.startswith("/"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Archive contains invalid path",
                    )
                dest_path = (target_dir / member_name).resolve()
                try:
                    dest_path.relative_to(STORAGE_ROOT)
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Archive contains illegal path",
                    )
            # Извлекаем после проверки
            zf.extractall(path=str(target_dir))
    elif archive_type in ("tar", "tar_gz"):
        mode = "r:gz" if archive_type == "tar_gz" else "r"
        with tarfile.open(archive_path, mode) as tf:
            # Проверяем все пути на безопасность
            for member in tf.getmembers():
                member_name = member.name
                if not member_name or member_name.startswith(("/", "\\")):
                    member_name = member_name.lstrip("/\\")
                if ".." in member_name or member_name.startswith("/"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Archive contains invalid path",
                    )
                dest_path = (target_dir / member_name).resolve()
                try:
                    dest_path.relative_to(STORAGE_ROOT)
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Archive contains illegal path",
                    )
            # Извлекаем после проверки
            tf.extractall(path=str(target_dir))

    rel_target = _relative_from_storage(target_dir)
    return {"detail": "unarchived", "target": rel_target}


@router.get("/download")
async def download_file(
    path: str,
    user: User = Depends(get_current_user),
) -> FileResponse:
    target = safe_join(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    content_length = target.stat().st_size
    return FileResponse(
        path=str(target),
        media_type="application/octet-stream",
        filename=target.name,
        content_length=content_length,
    )


@router.get("/share/status", response_model=ShareStatusResponse)
async def get_share_status(
    path: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ShareStatusResponse:
    target = safe_join(path)
    if not target.exists() or not target.is_file():
        return ShareStatusResponse(has_link=False)

    relative_path = _relative_from_storage(target)
    link = db.query(PublicLink).filter(PublicLink.file_path == relative_path).first()

    if link is None:
        return ShareStatusResponse(has_link=False)

    base_url = str(request.base_url).rstrip("/")
    direct_url = f"{base_url}/public/{link.token}"
    page_url = f"{base_url}/public/page/{link.token}"

    return ShareStatusResponse(
        has_link=True,
        token=link.token,
        direct_url=direct_url,
        page_url=page_url,
    )


@router.post("/share", response_model=ShareResponse)
async def create_share_link(
    payload: DeleteRequest,  # reusing simple { path: str } schema
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ShareResponse:
    target = safe_join(payload.path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    relative_path = _relative_from_storage(target)

    # Check if link already exists
    existing_link = db.query(PublicLink).filter(PublicLink.file_path == relative_path).first()

    if existing_link:
        base_url = str(request.base_url).rstrip("/")
        direct_url = f"{base_url}/public/{existing_link.token}"
        page_url = f"{base_url}/public/page/{existing_link.token}"
        return ShareResponse(
            url=direct_url,
            token=existing_link.token,
            direct_url=direct_url,
            page_url=page_url,
            exists=True,
        )

    # Create new link
    token = secrets.token_urlsafe(32)
    link = PublicLink(token=token, file_path=relative_path)
    db.add(link)
    db.commit()
    db.refresh(link)

    base_url = str(request.base_url).rstrip("/")
    direct_url = f"{base_url}/public/{token}"
    page_url = f"{base_url}/public/page/{token}"
    return ShareResponse(
        url=direct_url,
        token=token,
        direct_url=direct_url,
        page_url=page_url,
        exists=False,
    )


@router.delete("/share")
async def delete_share_link(
    payload: DeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    target = safe_join(payload.path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    relative_path = _relative_from_storage(target)
    link = db.query(PublicLink).filter(PublicLink.file_path == relative_path).first()

    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"detail": "link removed"}

