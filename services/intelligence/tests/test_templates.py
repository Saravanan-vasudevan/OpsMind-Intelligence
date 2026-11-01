from pathlib import Path

import pytest

from opsmind_intel.etl.schema import COLUMNS

TEMPLATES = Path(__file__).resolve().parents[3] / "frontend" / "public" / "templates"


@pytest.mark.parametrize("kind", ["production", "downtime"])
def test_frontend_template_header_matches_the_import_schema(kind):
    header = (TEMPLATES / f"{kind}_template.csv").read_text(encoding="utf-8").strip().splitlines()
    assert len(header) == 1, "templates are header-only so nobody imports example rows by accident"
    assert header[0].split(",") == COLUMNS[kind]
