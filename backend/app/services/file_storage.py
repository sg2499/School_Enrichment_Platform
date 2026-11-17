"""Where uploaded files are kept (#237). The rest of the app only ever calls
`get_storage()` and the three methods below, so the hosting team can move the
files (a private bucket, a file server) by adding one class here and setting
FILE_STORAGE; no other code, table or screen changes. Files are never served
by a public link: every download goes through the app's own sign-in and
role checks.

Backends:
  * "database" (the default): the bytes go in the stored_files table. Needs no
    disk and no extra service, so it works on Render as it is today. Fine for
    a pilot; a large rollout should move to a bucket.
  * "local": a folder (FILE_STORAGE_DIR). For development and tests.
"""
import os
import re
from pathlib import Path
from typing import Protocol

from sqlalchemy.orm import Session

from app.models import StoredFile

_SAFE_KEY = re.compile(r"^[A-Za-z0-9._/-]{1,120}$")


class FileStorage(Protocol):
    name: str

    def save(self, db: Session, key: str, data: bytes) -> None: ...

    def read(self, db: Session, key: str) -> bytes | None: ...

    def delete(self, db: Session, key: str) -> None: ...


def _check_key(key: str) -> str:
    if not _SAFE_KEY.match(key) or ".." in key:
        raise ValueError("Unsafe storage key")
    return key


class DatabaseStorage:
    name = "database"

    def save(self, db: Session, key: str, data: bytes) -> None:
        _check_key(key)
        row = db.get(StoredFile, key)
        if row is None:
            db.add(StoredFile(key=key, data=data))
        else:
            row.data = data
        db.flush()

    def read(self, db: Session, key: str) -> bytes | None:
        row = db.get(StoredFile, _check_key(key))
        return bytes(row.data) if row is not None else None

    def delete(self, db: Session, key: str) -> None:
        row = db.get(StoredFile, _check_key(key))
        if row is not None:
            db.delete(row)
            db.flush()


class LocalFolderStorage:
    name = "local"

    def __init__(self, folder: str):
        self.folder = Path(folder)

    def _path(self, key: str) -> Path:
        path = (self.folder / _check_key(key)).resolve()
        if self.folder.resolve() not in path.parents:
            raise ValueError("Unsafe storage key")
        return path

    def save(self, db: Session, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read(self, db: Session, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.exists() else None

    def delete(self, db: Session, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()


def get_storage(name: str | None = None) -> FileStorage:
    """The storage a file was saved with (`name`), or the one FILE_STORAGE
    names now. A file keeps the backend it was saved with, so switching
    storage later never strands the files already uploaded."""
    chosen = (name or os.getenv("FILE_STORAGE") or "database").strip().lower()
    if chosen == "local":
        return LocalFolderStorage(os.getenv("FILE_STORAGE_DIR") or "uploads")
    if chosen == "database":
        return DatabaseStorage()
    raise RuntimeError(f"FILE_STORAGE={chosen!r} is not a known storage; use 'database' or 'local'")
