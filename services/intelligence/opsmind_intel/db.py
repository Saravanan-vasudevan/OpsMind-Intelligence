from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row


@contextmanager
def connect(database_url: str) -> Iterator[psycopg.Connection]:
    """A connection whose rows are dicts. Commits on clean exit, rolls back on error."""
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        yield conn
