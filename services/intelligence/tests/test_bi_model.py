"""The Power BI star schema (schema `bi`), checked in PostgreSQL.

DAX itself cannot be run here. These tests check the two things that can be: (1) the model is a consistent star (no fact row points at a missing
dimension row, grains are what the docs say) and (2) the measure formulas in powerbi/measures.dax, re-computed in pandas from the bi tables only,
give the same numbers as the rest of the system (the v_equipment_daily view that the Excel report and forecasts use).
"""
from datetime import date

import pandas as pd
import pytest

from conftest import make_org
from opsmind_intel.etl.pipeline import run_import
from opsmind_intel.synthetic import generate

START = date(2026, 3, 1)


@pytest.fixture()
def org(conn, settings, small_specs):
    org = make_org(conn, specs=small_specs)
    data = generate(START, 21, seed=11, specs=small_specs)
    run_import(settings.database_url, settings, org, None, "p.csv", data.production.to_csv(index=False).encode(), "production")
    run_import(settings.database_url, settings, org, None, "d.csv", data.downtime.to_csv(index=False).encode(), "downtime")
    return org


def table(conn, name, org):
    return pd.DataFrame(conn.execute(f"SELECT * FROM bi.{name} WHERE organisation_id = %s", (org,)).fetchall())


def test_no_fact_row_points_at_a_missing_dimension_row(conn, org):
    fp, fd = table(conn, "fact_production", org), table(conn, "fact_downtime", org)
    assert len(fp) > 0 and len(fd) > 0
    dates = set(pd.DataFrame(conn.execute("SELECT date_key FROM bi.dim_date").fetchall())["date_key"])
    for fact in (fp, fd):
        assert set(fact["date_key"]) <= dates
        assert set(fact["equipment_id"]) <= set(table(conn, "dim_equipment", org)["equipment_id"])
        assert set(fact["plant_id"]) <= set(table(conn, "dim_plant", org)["plant_id"])
        assert set(fact["line_id"]) <= set(table(conn, "dim_line", org)["line_id"])
    assert set(fp["shift_id"]) <= set(table(conn, "dim_shift", org)["shift_id"])
    reasons = table(conn, "dim_downtime_reason", org)
    assert set(zip(fd["category"], fd["reason_code"])) <= set(zip(reasons["category"], reasons["reason_code"]))


def test_grains_are_one_row_per_record_and_event(conn, org):
    fp, fd = table(conn, "fact_production", org), table(conn, "fact_downtime", org)
    assert fp["production_record_id"].is_unique and fd["downtime_event_id"].is_unique
    count = conn.execute("SELECT count(*) c FROM production_records p JOIN equipment e ON e.id=p.equipment_id JOIN production_lines l ON l.id=e.production_line_id "
                         "JOIN plants pl ON pl.id=l.plant_id WHERE pl.organisation_id=%s", (org,)).fetchone()["c"]
    assert len(fp) == count          # the LEFT JOIN to quality never multiplies rows
    reasons = table(conn, "dim_downtime_reason", org)
    assert not reasons.duplicated(["category", "reason_code"]).any()


def test_dax_formulas_recomputed_from_the_star_schema_match_the_system(conn, org):
    fp, fd = table(conn, "fact_production", org), table(conn, "fact_downtime", org)
    fd["duration_minutes"] = fd["duration_minutes"].astype(float)       # numeric columns arrive as Decimal
    units, target = fp["units_produced"].sum(), fp["target_units"].sum()
    run, sched = fp["run_minutes"].sum(), fp["scheduled_minutes"].sum()
    inspected, rejected = fp["inspected_units"].sum(), fp["rejected_units"].sum()
    planned = fd.loc[fd["category"] == "Planned", "duration_minutes"].sum()
    unplanned = fd.loc[fd["category"] == "Unplanned", "duration_minutes"].sum()
    failures = int((fd["category"] == "Unplanned").sum())
    avail_minutes = sched - planned
    dax = {
        "attainment": units / target,
        "utilisation": run / sched,
        "defect_rate": rejected / inspected,
        "availability": max(0, (avail_minutes - unplanned) / avail_minutes),
        "mtbf": run / failures if failures else None,
        "mttr": unplanned / failures if failures else None,
    }
    daily = conn.execute(
        """SELECT sum(units) u, sum(target_units) t, sum(run_minutes) r, sum(scheduled_minutes) s, sum(inspected_units) i, sum(rejected_units) rj,
                  sum(planned_downtime_minutes) p, sum(unplanned_downtime_minutes) up, sum(failures) f
           FROM v_equipment_daily WHERE organisation_id = %s""", (org,)).fetchone()
    daily = {k: float(v) for k, v in daily.items()}      # SUM() of integers comes back as Decimal
    assert units == daily["u"] and failures == daily["f"]
    assert dax["attainment"] == pytest.approx(daily["u"] / daily["t"])
    assert dax["utilisation"] == pytest.approx(daily["r"] / daily["s"])
    assert dax["defect_rate"] == pytest.approx(daily["rj"] / daily["i"])
    # Downtime on days with no production record is in fact_downtime but not in v_equipment_daily (documented limitation); with this
    # fixture every downtime day has production, so the two agree.
    assert planned == daily["p"] and unplanned == daily["up"]
    assert dax["availability"] == pytest.approx(max(0, (daily["s"] - daily["p"] - daily["up"]) / (daily["s"] - daily["p"])))


def test_reliability_function_agrees_with_the_star_schema_per_machine(conn, org):
    fp, fd = table(conn, "fact_production", org), table(conn, "fact_downtime", org)
    rel = pd.DataFrame(conn.execute("SELECT * FROM fn_equipment_reliability(%s, %s, %s)", (org, START, date(2026, 3, 21))).fetchall())
    for row in rel.itertuples():
        run = fp.loc[fp["equipment_id"] == row.equipment_id, "run_minutes"].sum()
        mine = fd[(fd["equipment_id"] == row.equipment_id) & (fd["category"] == "Unplanned")]
        assert run == row.run_minutes and len(mine) == row.failures
        if len(mine):
            assert float(row.mtbf_minutes) == pytest.approx(run / len(mine), abs=0.06)       # the function rounds to 1 decimal
            assert float(row.mttr_minutes) == pytest.approx(mine["duration_minutes"].sum() / len(mine), abs=0.06)
        else:
            assert row.mtbf_minutes is None or pd.isna(row.mtbf_minutes)
