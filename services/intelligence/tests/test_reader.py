import io
from datetime import date, datetime

import openpyxl
import pytest

from opsmind_intel.etl.errors import FileRejected
from opsmind_intel.etl.reader import read_table
from opsmind_intel.etl.schema import PRODUCTION_COLUMNS

HEADER = ",".join(PRODUCTION_COLUMNS)
ROW = "NORTH,L1,M1,Day,2026-03-01,100,120,400,,,,"


def read(text: str | bytes, name="f.csv", kind="production", max_rows=1000):
    data = text if isinstance(text, bytes) else text.encode("utf-8")
    return read_table(data, name, kind, max_rows)


def test_csv_with_bom_is_read_and_row_numbers_start_at_two():
    t = read("﻿" + HEADER + "\n" + ROW + "\n")
    assert t.source_format == "csv" and list(t.frame["row_number"]) == [2]
    assert t.frame["units_produced"].iloc[0] == "100"
    assert len(t.sha256) == 64


def test_headers_are_normalised():
    h = "Plant Code,LINE-CODE,Asset_Code,Shift Name,Shift_Date,Units Produced,Target Units,Run Minutes"
    t = read(h + "\nNORTH,L1,M1,Day,2026-03-01,1,2,3\n")
    assert "plant_code" in t.frame.columns and "line_code" in t.frame.columns


def test_semicolon_delimited_files_are_supported():
    t = read(HEADER.replace(",", ";") + "\n" + ROW.replace(",", ";") + "\n")
    assert t.frame["asset_code"].iloc[0] == "M1"


def test_null_tokens_become_blank_and_blank_lines_are_skipped_with_row_numbers_preserved():
    t = read(HEADER + "\n" + "NORTH,L1,M1,Day,2026-03-01,100,120,400,N/A,NA,-,null\n" + ",,,,,,,,,,,\n" + ROW.replace("M1", "M2") + "\n")
    assert t.frame["inspected_units"].iloc[0] == "" and t.frame["notes"].iloc[0] == ""
    assert list(t.frame["row_number"]) == [2, 4]


def test_unknown_columns_produce_a_warning_not_an_error():
    t = read(HEADER + ",extra\n" + ROW + ",zzz\n")
    assert any("extra" in w for w in t.warnings)
    assert "extra" not in t.frame.columns


def test_windows_1252_fallback():
    t = read((HEADER + "\n" + ROW.replace("NORTH", "NÖRTH") + "\n").encode("cp1252"))
    assert t.frame["plant_code"].iloc[0] == "NÖRTH" and t.warnings


@pytest.mark.parametrize("payload,name,code", [
    (b"", "f.csv", "empty_file"),
    (b"not,a,real\n1,2,3\n", "f.csv", "missing_columns"),
    ((HEADER + "\n").encode(), "f.csv", "no_data_rows"),
    (b"hello", "f.txt", "unsupported_format"),
    (b"hello", "f.xlsx", "invalid_file"),
    (b"PK\x03\x04garbage", "f.xlsx", "unreadable_file"),
    ((HEADER + ",plant_code\n" + ROW + ",x\n").encode(), "f.csv", "duplicate_columns"),
])
def test_file_level_rejections(payload, name, code):
    with pytest.raises(FileRejected) as exc:
        read(payload, name)
    assert exc.value.code == code


def test_row_limit():
    with pytest.raises(FileRejected) as exc:
        read(HEADER + "\n" + "\n".join(ROW for _ in range(5)) + "\n", max_rows=3)
    assert exc.value.code == "too_many_rows"


def test_excel_dates_numbers_and_empty_cells_become_clean_text():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(PRODUCTION_COLUMNS)
    ws.append(["NORTH", "L1", "M1", "Day", datetime(2026, 3, 1), 100, 120.0, 400, None, None, None, None])
    ws.append(["NORTH", "L1", "M1", "Day", date(2026, 3, 2), 100.0, 120, 400, 50, 2, "SURFACE", "note"])
    buf = io.BytesIO()
    wb.save(buf)
    t = read(buf.getvalue(), "f.xlsx")
    assert t.source_format == "xlsx"
    assert list(t.frame["shift_date"]) == ["2026-03-01", "2026-03-02"]
    assert list(t.frame["units_produced"]) == ["100", "100"]
    assert list(t.frame["inspected_units"]) == ["", "50"]


def test_downtime_kind_requires_its_own_columns():
    with pytest.raises(FileRejected) as exc:
        read(HEADER + "\n" + ROW + "\n", kind="downtime")
    assert exc.value.code == "missing_columns" and "start_time" in exc.value.message
