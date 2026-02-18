from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import auth, files, public
from .database import init_db

# Загружаем переменные окружения из .env файла (если он существует)
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)


app = FastAPI(title="Personal Cloud Storage")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth.router)
app.include_router(files.router)
app.include_router(public.router)


app.mount(
    "/",
    StaticFiles(directory="frontend", html=True),
    name="frontend",
)


@app.on_event("startup")
def on_startup() -> None:
    # Initialize database schema and ensure the first user exists
    init_db()

