"""Turn an uploaded CSV or Excel file into a table of trimmed strings. No business rules here."""
from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date, datetime

import pandas as pd

from .errors import FileRejected
from .schema import COLUMNS, NULL_TOKENS, REQUIRED


@dataclass
class RawTable:
    frame: pd.DataFrame            # all string columns, one row per data row, plus `row_number`
    source_format: str             # 'csv' | 'xlsx'
    sha256: str
    warnings: list[str]


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def normalise_header(name: object) -> str:
    return re.sub(r"[\s\-]+", "_", str(name).strip().lower())


def _decode_csv(content: bytes, warnings: list[str]) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        warnings.append("File is not valid UTF-8; it was read as Windows-1252.")
        return content.decode("cp1252")


def _detect_delimiter(text: str) -> str:
    header = text.splitlines()[0] if text.splitlines() else ""
    counts = {d: header.count(d) for d in (",", ";", "\t")}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ","


def _cell_to_text(value: object) -> str:
    """Excel cells arrive typed. Convert to the text a person would have typed."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, pd.Timestamp):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time() == datetime.min.time() else value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read_table(content: bytes, filename: str, kind: str, max_rows: int) -> RawTable:
    if not content:
        raise FileRejected("empty_file", "The file is empty.")

    lower = filename.lower()
    warnings: list[str] = []
    try:
        if lower.endswith(".csv"):
            text = _decode_csv(content, warnings)
            frame = pd.read_csv(io.StringIO(text), sep=_detect_delimiter(text), dtype=str, keep_default_na=False, header=None, skip_blank_lines=False)
            frame = frame.fillna("")
            fmt = "csv"
        elif lower.endswith(".xlsx"):
            if not content.startswith(b"PK"):
                raise FileRejected("invalid_file", "The file has an .xlsx extension but is not an Excel workbook.")
            frame = pd.read_excel(io.BytesIO(content), sheet_name=0, dtype=object, engine="openpyxl", header=None)
            frame = frame.apply(lambda col: col.map(_cell_to_text))
            fmt = "xlsx"
        else:
            raise FileRejected("unsupported_format", "Only .csv and .xlsx files are supported.")
    except FileRejected:
        raise
    except pd.errors.EmptyDataError:
        raise FileRejected("empty_file", "The file has no header row.") from None
    except Exception as exc:  # parser errors are varied; report the type, not internals
        raise FileRejected("unreadable_file", f"The file could not be read ({type(exc).__name__}).") from None

    if frame.empty:
        raise FileRejected("empty_file", "The file has no header row.")
    # The first row is the header. Reading with header=None keeps repeated names visible instead of renaming them.
    header = [normalise_header(c) for c in frame.iloc[0]]
    frame = frame.iloc[1:].copy()
    frame.columns = header
    frame = frame.reset_index(drop=True)
    duplicated = sorted({c for c in frame.columns if list(frame.columns).count(c) > 1})
    if duplicated:
        raise FileRejected("duplicate_columns", f"Column names must be unique; repeated: {', '.join(duplicated)}.")

    missing = [c for c in REQUIRED[kind] if c not in frame.columns]
    if missing:
        raise FileRejected("missing_columns", f"Required column(s) missing: {', '.join(missing)}.")

    unknown = [c for c in frame.columns if c not in COLUMNS[kind]]
    if unknown:
        warnings.append(f"Ignored unknown column(s): {', '.join(unknown)}.")

    for column in COLUMNS[kind]:
        if column not in frame.columns:
            frame[column] = ""
    frame = frame[COLUMNS[kind]].astype(str)
    for column in frame.columns:
        frame[column] = frame[column].str.strip()
        frame.loc[frame[column].str.lower().isin(NULL_TOKENS), column] = ""

    # Drop rows that are entirely blank (trailing empty lines in exports) but keep original row numbers.
    frame.insert(0, "row_number", range(2, len(frame) + 2))
    frame = frame[(frame.drop(columns="row_number") != "").any(axis=1)].reset_index(drop=True)

    if len(frame) == 0:
        raise FileRejected("no_data_rows", "The file has a header but no data rows.")
    if len(frame) > max_rows:
        raise FileRejected("too_many_rows", f"The file has {len(frame):,} rows; the limit is {max_rows:,}. Split it into smaller files.")

    return RawTable(frame=frame, source_format=fmt, sha256=sha256_hex(content), warnings=warnings)
