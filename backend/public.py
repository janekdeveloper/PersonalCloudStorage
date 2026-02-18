from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session

from .database import get_db
from .files import STORAGE_ROOT, safe_join
from .models import PublicLink
from fastapi import Depends


router = APIRouter(prefix="/public", tags=["public"])


@router.get("/{token}")
def get_public_file(
    token: str,
    db: Session = Depends(get_db),
) -> FileResponse:
    """
    Public endpoint that serves a file directly by token.
    No authentication is required.
    """
    link = db.query(PublicLink).filter(PublicLink.token == token).first()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    file_path = safe_join(link.file_path)

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    return FileResponse(
        path=str(file_path),
        media_type="application/octet-stream",
        filename=file_path.name,
    )


@router.get("/page/{token}", response_class=HTMLResponse)
def get_public_page(
    token: str,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """
    Public landing page for a shared file.
    Shows basic info and a download button that points to the direct link.
    """
    link = db.query(PublicLink).filter(PublicLink.token == token).first()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    file_path = safe_join(link.file_path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    name = file_path.name
    size = file_path.stat().st_size

    def _format_bytes(num: int) -> str:
        units = ["B", "KB", "MB", "GB", "TB"]
        k = 1024.0
        i = 0
        value = float(num)
        while value >= k and i < len(units) - 1:
            value /= k
            i += 1
        if value >= 10:
            formatted = f"{value:.0f}"
        else:
            formatted = f"{value:.1f}"
        return f"{formatted} {units[i]}"

    size_str = _format_bytes(size)
    download_href = f"/public/{token}"

    html = f"""
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Скачивание файла</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {{
            margin: 0;
            padding: 0;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: radial-gradient(circle at top, #1d4ed8 0, #020617 55%);
            color: #e5e7eb;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .card {{
            background: #020617;
            border-radius: 16px;
            padding: 24px 22px 20px;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 24px 50px rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(148, 163, 184, 0.5);
        }}
        .title {{
            margin: 0 0 10px;
            font-size: 18px;
            font-weight: 600;
        }}
        .filename {{
            font-size: 14px;
            word-break: break-all;
            margin-bottom: 4px;
        }}
        .meta {{
            font-size: 13px;
            color: #9ca3af;
            margin-bottom: 16px;
        }}
        .btn {{
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 8px 16px;
            border-radius: 999px;
            border: none;
            cursor: pointer;
            background: linear-gradient(135deg, #2563eb, #4f46e5);
            color: #f9fafb;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            box-shadow: 0 12px 25px rgba(37, 99, 235, 0.45);
        }}
        .btn:hover {{
            background: linear-gradient(135deg, #1d4ed8, #4338ca);
        }}
    </style>
</head>
<body>
    <div class="card">
        <h1 class="title">Скачивание файла</h1>
        <div class="filename">{name}</div>
        <div class="meta">Размер: {size_str}</div>
        <a class="btn" href="{download_href}">Скачать</a>
    </div>
</body>
</html>
"""

    return HTMLResponse(content=html)

