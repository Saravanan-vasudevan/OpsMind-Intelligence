from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    internal_api_key: str
    max_upload_bytes: int = 10 * 1024 * 1024
    max_rows: int = 50_000
    max_stored_errors: int = 1_000


def get_settings() -> Settings:
    """Read settings from the environment on each call so tests can change them."""
    return Settings(
        database_url=os.environ.get("DATABASE_URL", ""),
        internal_api_key=os.environ.get("INTERNAL_API_KEY", ""),
        max_upload_bytes=int(os.environ.get("MAX_UPLOAD_BYTES", 10 * 1024 * 1024)),
        max_rows=int(os.environ.get("MAX_IMPORT_ROWS", 50_000)),
        max_stored_errors=int(os.environ.get("MAX_STORED_ERRORS", 1_000)),
    )
