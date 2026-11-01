from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from opsmind_intel.config import Settings
from opsmind_intel.synthetic import create_structure, machine_specs

MIGRATIONS = Path(__file__).resolve().parents[3] / "database" / "migrations"


def _admin_url() -> str:
    return os.environ.get("TEST_PG_ADMIN_URL", "postgresql://postgres@localhost:55432/postgres")


@pytest.fixture(scope="session")
def database_url():
    """A throwaway database with the real migrations applied.

    Needs a PostgreSQL server (set TEST_PG_ADMIN_URL). If none is reachable the database tests are skipped, unless
    TEST_PG_REQUIRED=1 (used in CI) in which case they fail.
    """
    admin = _admin_url()
    try:
        admin_conn = psycopg.connect(admin, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as exc:
        if os.environ.get("TEST_PG_REQUIRED") == "1":
            raise
        pytest.skip(f"No PostgreSQL server reachable at TEST_PG_ADMIN_URL ({exc.__class__.__name__}); database tests skipped")

    name = f"opsmind_test_{uuid.uuid4().hex[:10]}"
    admin_conn.execute(f'CREATE DATABASE "{name}"')
    base, _, _ = admin.rpartition("/")
    url = f"{base}/{name}"
    with psycopg.connect(url, autocommit=True) as conn:
        for path in sorted(MIGRATIONS.glob("*.sql")):
            conn.execute(path.read_text(encoding="utf-8"))
    yield url
    admin_conn.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
    admin_conn.close()


@pytest.fixture()
def conn(database_url):
    with psycopg.connect(database_url, row_factory=dict_row, autocommit=True) as c:
        yield c


@pytest.fixture()
def settings(database_url):
    return Settings(database_url=database_url, internal_api_key="test-key")


def make_org(conn, with_structure: bool = True, specs=None) -> uuid.UUID:
    org = conn.execute("INSERT INTO organisations (name) VALUES (%s) RETURNING id", (f"Org {uuid.uuid4().hex[:8]}",)).fetchone()["id"]
    if with_structure:
        create_structure(conn, org, specs)
    return org


@pytest.fixture()
def org(conn):
    """An organisation with the standard synthetic plants/lines/shifts/equipment (24 machines)."""
    return make_org(conn)


@pytest.fixture()
def small_specs():
    """North plant only, one line, two machines: quick to reason about."""
    return [s for s in machine_specs(lines=1, machines=2) if s.plant_code == "NORTH"]
