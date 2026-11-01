from __future__ import annotations

from dataclasses import dataclass


class FileRejected(Exception):
    """The file as a whole cannot be processed (unreadable, wrong columns, too large). Nothing is loaded."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class RowError:
    row_number: int          # spreadsheet row; the header is row 1, so data starts at 2. 0 = whole file.
    column: str | None
    code: str
    message: str
    raw_value: str | None = None
