# PersonalCloudStorage

[English version](#personalcloudstorage-english)

Простое личное файловое хранилище для VPS: авторизация, просмотр и управление файлами, загрузка через drag & drop, а также публичные прямые ссылки на файлы.

## Стек

- **Backend**: Python 3.11+, FastAPI, SQLite (SQLAlchemy), JWT в HttpOnly cookie
- **Frontend**: Чистый HTML + CSS + Vanilla JS
- **Хранение файлов**: на диске в директории `storage/`

## Структура проекта

- `backend/`
  - `main.py` — точка входа FastAPI, роутеры, статика, CORS
  - `auth.py` — авторизация, JWT, логин/логаут, зависимость `get_current_user`
  - `files.py` — листинг, загрузка, создание папок, удаление, переименование, скачивание, шэринг
  - `public.py` — публичный эндпоинт `/public/{token}` с прямой выдачей файла
  - `models.py` — модели `User` и `PublicLink`
  - `database.py` — подключение к SQLite, создание таблиц, создание первого пользователя
- `frontend/`
  - `login.html` — страница входа
  - `index.html` — файловый менеджер
  - `styles.css` — стили интерфейса
  - `app.js` — логика фронтенда, обращения к API
- `storage/` — корень для всех файлов пользователя
- `requirements.txt` — зависимости backend

## Установка и запуск (локально)

1. **Клонируйте проект / скопируйте файлы**

   ```bash
   cd /home/jandev/Projects/MySimpleCloudStorage
   ```

2. **Создайте и активируйте виртуальное окружение (если ещё не активировано)**

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Установите зависимости**

   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

4. **Создайте директорию для файлов**

   Если директория `storage/` ещё не существует:

   ```bash
   mkdir -p storage
   ```

5. **Настройте переменные окружения**

   Приложение автоматически загружает переменные из файла `.env` (если он существует).

   **Рекомендуемый способ:**
   
   Скопируйте `.env.example` в `.env` и отредактируйте значения:

   ```bash
   cp .env.example .env
   # Отредактируйте .env и задайте свои значения
   ```

   **Переменные окружения:**
   
   - `CLOUD_ADMIN_USERNAME` (по умолчанию: `admin`) — логин первого пользователя
   - `CLOUD_ADMIN_PASSWORD` (по умолчанию: `admin`) — пароль первого пользователя
   - `CLOUD_JWT_SECRET` (по умолчанию: `change_me_in_production`) — секретный ключ для JWT
   - `CLOUD_JWT_EXPIRE_DAYS` (по умолчанию: `7`) — срок действия токена в днях

   **ВАЖНО:** Перед деплоем на VPS обязательно измените пароль и секрет JWT на надёжные значения!

   **Альтернативный способ:** можно задать переменные окружения напрямую:

   ```bash
   export CLOUD_ADMIN_USERNAME=myuser
   export CLOUD_ADMIN_PASSWORD=mypassword
   export CLOUD_JWT_SECRET="some-long-random-secret"
   ```

6. **Запустите backend**

   ```bash
   uvicorn backend.main:app --reload
   ```

   По умолчанию приложение будет доступно по адресу `http://127.0.0.1:8000/`.

7. **Откройте фронтенд**

   FastAPI раздаёт статику из директории `frontend/`, поэтому:

   - Страница логина: `http://127.0.0.1:8000/login.html`
   - Файловый менеджер: `http://127.0.0.1:8000/index.html`

   После успешного входа (логин/пароль из шага 5) вы попадёте на файловый менеджер.

## Права доступа и безопасность

- Все эндпоинты `/files/*` и `/auth/logout` требуют авторизации.
- Авторизация — через JWT, хранящийся в HttpOnly cookie `access_token`.
- Без авторизации:
  - **нельзя** просматривать список файлов, загружать, удалять, переименовывать, скачивать из приватного интерфейса;
  - **можно** скачивать файлы только по публичной ссылке `/public/{token}`.

### Path traversal и защита файловой системы

- Все пути, приходящие в файловые эндпоинты, считаются **относительными** относительно корня `./storage`.
- Для построения реального пути используется функция безопасного соединения в `backend/files.py`, которая:
  - нормализует путь;
  - соединяет его с `STORAGE_ROOT = Path("./storage").resolve()`;
  - проверяет, что результат **остаётся внутри** `STORAGE_ROOT` (защит от `../` и подобных приёмов).
- В таблице `PublicLink.file_path` хранится уже нормализованный относительный путь.
- Эндпоинт `/public/{token}` всегда обращается только к файлу внутри `storage/`.

### Публичные ссылки

- Публичная ссылка создаётся через `POST /files/share` (только для авторизованного пользователя).
- В БД создаётся запись `PublicLink` с полями:
  - `token` — случайная строка, генерируемая через `secrets.token_urlsafe(32)`;
  - `file_path` — относительный путь к файлу от `storage/`;
  - `created_at` — timestamp создания.
- Эндпоинт `GET /public/{token}`:
  - ищет запись по токену;
  - строит безопасный путь к файлу;
  - отдаёт файл напрямую через `FileResponse` (без HTML и редиректов).

Ссылка выглядит примерно так:

- `https://myvps.com/public/AbCDef1234567890...`

## Деплой на VPS

### Вариант 1: uvicorn напрямую (минималистичный)

1. Скопируйте проект на сервер (например, в `/opt/my-cloud/`).
2. Установите Python 3.11+ и создайте виртуальное окружение:

   ```bash
   cd /opt/my-cloud
   python3 -m venv venv
   source venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   mkdir -p storage
   ```

3. Задайте переменные окружения (логин/пароль и секрет JWT).
4. Запустите приложение (например, через systemd или tmux/screen):

   ```bash
   uvicorn backend.main:app --host 0.0.0.0 --port 8000
   ```

5. Откройте в браузере: `http://your-vps-ip:8000/login.html`.

Этот вариант подходит для тестирования или если вы будете ставить Nginx перед приложением.

### Вариант 2: gunicorn + uvicorn worker + Nginx (рекомендуется)

1. Установите дополнительные пакеты:

   ```bash
   pip install "gunicorn[gevent]" uvicorn[standard]
   ```

2. Запускайте приложение через gunicorn:

   ```bash
   gunicorn backend.main:app \
     -w 4 \
     -k uvicorn.workers.UvicornWorker \
     -b 0.0.0.0:8000
   ```

3. Настройте Nginx как reverse-proxy (примерно):

   ```nginx
   server {
       listen 80;
       server_name myvps.com;

       client_max_body_size 2G;  # максимальный размер загружаемых файлов

       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

4. Настройте HTTPS (например, через Let’s Encrypt / certbot).

После этого приложение будет доступно по `https://myvps.com/login.html`, а публичные ссылки вида `https://myvps.com/public/<token>` будут напрямую отдавать файлы.

## Где задать логин/пароль и где лежат файлы

- **Логин и пароль первого пользователя**:
  - через файл `.env` (рекомендуется) или переменные окружения `CLOUD_ADMIN_USERNAME` и `CLOUD_ADMIN_PASSWORD`;
  - при первом старте backend создаёт пользователя с этими данными (если такого ещё нет);
  - см. `.env.example` для примера конфигурации.
- **Секрет JWT**:
  - через файл `.env` (рекомендуется) или переменную окружения `CLOUD_JWT_SECRET`;
  - **ВАЖНО:** используйте длинную случайную строку в продакшене!
- **Файлы пользователя**:
  - физически лежат в директории `storage/` рядом с проектом;
  - вся структура папок, которую вы видите в веб-интерфейсе, — это структура внутри `storage/`.

## Проверка работы

После запуска убедитесь, что:

1. Вы можете зайти на `http://127.0.0.1:8000/login.html`, войти под заданным логином/паролем и попасть в файловый менеджер.
2. Видите список файлов и папок (корень `storage/`).
3. Можете:
   - создать папку;
   - загрузить файл (через кнопку или drag & drop);
   - скачать, переименовать и удалить файл/папку;
   - получить публичную ссылку на файл.
4. Открыв публичную ссылку в другом браузере/инкогнито вы сразу получаете скачивание файла, без страницы и без авторизации.

Проект самодостаточный: достаточно установить зависимости, запустить `uvicorn backend.main:app` и открыть `login.html` / `index.html` в браузере. 

---

# PersonalCloudStorage (English)

Simple personal file storage for a VPS: authentication, browsing and managing files, drag & drop uploads, and public direct download links.

## Tech stack

- **Backend**: Python 3.11+, FastAPI, SQLite (SQLAlchemy), JWT in HttpOnly cookie
- **Frontend**: Plain HTML + CSS + Vanilla JS
- **File storage**: on disk in the `storage/` directory

## Project structure

- `backend/`
  - `main.py` — FastAPI entrypoint, routers, static files, CORS
  - `auth.py` — authentication, JWT, login/logout, `get_current_user` dependency
  - `files.py` — listing, upload, folder creation, delete, rename, download, sharing
  - `public.py` — public endpoint `/public/{token}` that directly serves the file
  - `models.py` — `User` and `PublicLink` models
  - `database.py` — SQLite engine, tables creation, first user creation
- `frontend/`
  - `login.html` — login page
  - `index.html` — file manager UI
  - `styles.css` — UI styles
  - `app.js` — frontend logic, API calls
- `storage/` — root for all user files
- `requirements.txt` — backend dependencies

## Install & run (local)

1. **Go to the project**

   ```bash
   cd /home/jandev/Projects/MySimpleCloudStorage
   ```

2. **Create and activate a virtualenv**

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**

   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

4. **Create the storage directory**

   ```bash
   mkdir -p storage
   ```

5. **Configure environment variables**

   The app automatically loads variables from `.env` (if present).

   **Recommended:**

   ```bash
   cp .env.example .env
   # Edit .env and put your values
   ```

   Variables:

   - `CLOUD_ADMIN_USERNAME` (default: `admin`) — first user login
   - `CLOUD_ADMIN_PASSWORD` (default: `admin`) — first user password
   - `CLOUD_JWT_SECRET` (default: `change_me_in_production`) — JWT secret key
   - `CLOUD_JWT_EXPIRE_DAYS` (default: `7`) — token lifetime in days

   **IMPORTANT:** Change password and JWT secret to strong values before deploying to a VPS.

   **Alternative:** set variables directly:

   ```bash
   export CLOUD_ADMIN_USERNAME=myuser
   export CLOUD_ADMIN_PASSWORD=mypassword
   export CLOUD_JWT_SECRET="some-long-random-secret"
   ```

6. **Run backend**

   ```bash
   uvicorn backend.main:app --reload
   ```

   Default URL: `http://127.0.0.1:8000/`.

7. **Open frontend**

   - Login page: `http://127.0.0.1:8000/login.html`
   - File manager: `http://127.0.0.1:8000/index.html`

   After successful login (credentials from step 5) you will see the file manager.

## Access control & security

- All `/files/*` endpoints and `/auth/logout` require authentication.
- Authentication uses a JWT stored in an HttpOnly `access_token` cookie.
- Without authentication:
  - **you CANNOT** browse the file list, upload, delete, rename, or download from the private interface;
  - **you CAN** download files only via public `/public/{token}` links.

### Path traversal protection

- All paths from requests are treated as **relative** to `./storage`.
- `backend/files.py` has a `safe_join` helper that:
  - normalizes the path;
  - joins it with `STORAGE_ROOT = Path("./storage").resolve()`;
  - ensures the final path stays **inside** `STORAGE_ROOT` (prevents `../` tricks).
- `PublicLink.file_path` stores normalized relative paths.
- `/public/{token}` always resolves a file only inside `storage/`.

### Public links

- Public links are created by `POST /files/share` (authenticated only).
- A `PublicLink` row is stored:
  - `token` — random string from `secrets.token_urlsafe(32)`;
  - `file_path` — relative path from `storage/`;
  - `created_at` — creation timestamp.
- `GET /public/{token}`:
  - looks up the link by token;
  - resolves a safe path via `safe_join`;
  - returns the file directly via `FileResponse` (no HTML, no redirects).

Typical link:

- `https://myvps.com/public/AbCDef1234567890...`

## Deploying to a VPS

### Option 1: plain uvicorn

1. Copy project to the server (e.g. `/opt/my-cloud/`).
2. Install Python 3.11+, create venv, install deps, create `storage/`.
3. Configure env vars (login/password, JWT secret).
4. Run:

   ```bash
   uvicorn backend.main:app --host 0.0.0.0 --port 8000
   ```

5. Open: `http://your-vps-ip:8000/login.html`.

### Option 2: gunicorn + uvicorn worker + Nginx (recommended)

1. Install:

   ```bash
   pip install "gunicorn[gevent]" uvicorn[standard]
   ```

2. Run app via gunicorn:

   ```bash
   gunicorn backend.main:app \
     -w 4 \
     -k uvicorn.workers.UvicornWorker \
     -b 0.0.0.0:8000
   ```

3. Configure Nginx as reverse-proxy (similar to the Russian section, with `client_max_body_size` and HTTPS).

## Where to set credentials and where files live

- **First user credentials**:
  - via `.env` (recommended) or env vars `CLOUD_ADMIN_USERNAME` / `CLOUD_ADMIN_PASSWORD`;
  - on first startup backend creates a user with these values if it does not exist yet;
  - see `.env.example` for a template.
- **JWT secret**:
  - via `.env` (recommended) or env var `CLOUD_JWT_SECRET`;
  - **IMPORTANT:** use a long random string in production.
- **User files**:
  - physically stored in the `storage/` directory next to the project;
  - the folder structure you see in the web UI is exactly the structure inside `storage/`.

## Sanity check

After starting the app, verify:

1. You can open `http://127.0.0.1:8000/login.html`, log in, and see the file manager.
2. You see files and folders from the `storage/` root.
3. You can:
   - create a folder;
   - upload files (button or drag & drop);
   - download, rename, and delete files/folders;
   - generate a public link for a file.
4. Opening a public link in another browser/incognito starts the download immediately, with no HTML page and no auth required.

Project is self-contained: just install deps, run `uvicorn backend.main:app`, and open `login.html` / `index.html` in your browser.
