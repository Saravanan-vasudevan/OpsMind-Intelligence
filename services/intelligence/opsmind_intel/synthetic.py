"""Synthetic manufacturing data. EVERYTHING produced here is invented; it represents no real company.

Two uses:
  * tests and the anomaly benchmark (with labels saying exactly where patterns were planted);
  * `tools/make_history_csv.py`, which writes import-ready CSV files for the demo.

The structure and value distributions deliberately mirror the C# demo seeder (Data/DemoDataSeeder.cs) so
generated files import into an organisation seeded by it. Asset codes look like N1-M01.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import psycopg

PLANTS = [("North Plant", "NORTH"), ("South Plant", "SOUTH"), ("East Plant", "EAST")]
CATEGORIES = [("CNC Machine", 55.0, 0.018), ("Injection Moulder", 120.0, 0.024), ("Packaging Line", 200.0, 0.012), ("Hydraulic Press", 90.0, 0.020)]
SHIFTS = [("Early", "06:00", "14:00"), ("Late", "14:00", "22:00"), ("Night", "22:00", "06:00")]
UNPLANNED_REASONS = ["MECH_FAIL", "ELEC_FAULT", "MATERIAL_SHORT", "JAM", "SENSOR", "OPERATOR"]
SHIFT_MINUTES = 480


@dataclass(frozen=True)
class MachineSpec:
    plant_name: str
    plant_code: str
    line_code: str
    asset_code: str
    category: str
    ideal_rate: float
    reject_rate: float


def machine_specs(lines: int = 2, machines: int = 4) -> list[MachineSpec]:
    specs = []
    for plant_name, code in PLANTS:
        for line in range(1, lines + 1):
            for m in range(1, machines + 1):
                cat = CATEGORIES[(m - 1) % len(CATEGORIES)]
                specs.append(MachineSpec(plant_name, code, f"L{line}", f"{code[0]}{line}-M{m:02d}", cat[0], cat[1], cat[2]))
    return specs


@dataclass(frozen=True)
class Pattern:
    """A planted effect. kind: failure_cluster | reject_boost | demand_dip. Window is inclusive of both dates."""
    kind: str
    start: date
    end: date
    asset_code: str | None = None     # failure_cluster targets one machine
    plant_code: str | None = None     # reject_boost / demand_dip target a plant
    factor: float = 1.0               # multiplier for reject_boost (rate) / demand_dip (output)
    failure_chance: float = 0.16      # per shift, for failure_cluster

    def covers(self, spec: MachineSpec, day: date) -> bool:
        if not (self.start <= day <= self.end):
            return False
        return spec.asset_code == self.asset_code if self.kind == "failure_cluster" else spec.plant_code == self.plant_code


def default_patterns(end: date) -> list[Pattern]:
    """Patterns used for the history pack and the demo benchmark; `end` is the last generated day."""
    return [
        Pattern("failure_cluster", end - timedelta(days=25), end - timedelta(days=16), asset_code="N2-M03"),
        Pattern("reject_boost", end - timedelta(days=40), end - timedelta(days=29), plant_code="SOUTH", factor=2.2),
        Pattern("demand_dip", end - timedelta(days=70), end - timedelta(days=63), plant_code="EAST", factor=0.78),
    ]


@dataclass
class Generated:
    production: pd.DataFrame           # import-ready columns (see etl/schema.py)
    downtime: pd.DataFrame
    labels: pd.DataFrame               # asset_code, day, kind  — where a pattern was planted
    patterns: list[Pattern] = field(default_factory=list)


def generate(start: date, days: int, seed: int = 42, patterns: list[Pattern] | None = None, specs: list[MachineSpec] | None = None) -> Generated:
    """Deterministic for a given (start, days, seed, patterns). Days are start .. start+days-1."""
    specs = specs or machine_specs()
    patterns = patterns if patterns is not None else []
    prod_rows, down_rows, label_rows = [], [], []

    for idx, spec in enumerate(specs):
        rng = np.random.default_rng([seed, idx])
        for offset in range(days):
            day = start + timedelta(days=offset)
            weekend = day.weekday() >= 5
            active = [p for p in patterns if p.covers(spec, day)]
            for p in active:
                label_rows.append((spec.asset_code, day, p.kind))
            demand = min([p.factor for p in active if p.kind == "demand_dip"], default=1.0)
            reject_boost = max([p.factor for p in active if p.kind == "reject_boost"], default=1.0)
            fail_chance = max([p.failure_chance for p in active if p.kind == "failure_cluster"], default=0.035)

            for shift_name, start_t, _ in SHIFTS:
                if weekend and shift_name != "Early":
                    continue
                if shift_name == "Night" and spec.asset_code.endswith("M03"):
                    continue
                shift_start = datetime.combine(day, datetime.strptime(start_t, "%H:%M").time(), tzinfo=timezone.utc)
                downtime = 0.0
                if day.weekday() == 2 and shift_name == "Early":
                    down_rows.append(_downtime(spec, shift_start, shift_start + timedelta(minutes=60), "Planned", "PLANNED_MAINT"))
                    downtime += 60
                if rng.random() < fail_chance:
                    duration = int(rng.integers(15, 181))
                    at = int(rng.integers(61, max(62, SHIFT_MINUTES - duration)))
                    reason = "MECH_FAIL" if fail_chance > 0.035 else UNPLANNED_REASONS[int(rng.integers(len(UNPLANNED_REASONS)))]
                    begin = shift_start + timedelta(minutes=at)
                    down_rows.append(_downtime(spec, begin, begin + timedelta(minutes=duration), "Unplanned", reason))
                    downtime += duration
                changeover = int(rng.integers(10, 31))
                run = int(max(0, SHIFT_MINUTES - downtime - changeover))
                efficiency = 0.82 + rng.random() * 0.15
                units = int(round(spec.ideal_rate * run / 60.0 * efficiency * demand))
                target = int(round(spec.ideal_rate * SHIFT_MINUTES / 60.0 * 0.9))
                rate = min(0.25, spec.reject_rate * reject_boost * (0.7 + rng.random() * 0.6))
                rejected = min(int(round(units * rate)), units)
                defect = ("DIMENSION" if rng.random() < 0.5 else "SURFACE") if rejected > 0 else ""
                prod_rows.append({
                    "plant_code": spec.plant_code, "line_code": spec.line_code, "asset_code": spec.asset_code, "shift_name": shift_name,
                    "shift_date": day.isoformat(), "units_produced": units, "target_units": target, "run_minutes": run,
                    "inspected_units": units, "rejected_units": rejected, "defect_type": defect, "notes": "",
                })

    labels = pd.DataFrame(label_rows, columns=["asset_code", "day", "kind"])
    return Generated(pd.DataFrame(prod_rows), pd.DataFrame(down_rows), labels, patterns)


def _downtime(spec: MachineSpec, start: datetime, end: datetime, category: str, reason: str) -> dict:
    return {"plant_code": spec.plant_code, "line_code": spec.line_code, "asset_code": spec.asset_code,
            "start_time": start.isoformat().replace("+00:00", "Z"), "end_time": end.isoformat().replace("+00:00", "Z"),
            "category": category, "reason_code": reason, "notes": ""}


def create_structure(conn: psycopg.Connection, organisation_id: uuid.UUID, specs: list[MachineSpec] | None = None) -> None:
    """Insert plants, lines, shifts, categories and equipment for one organisation (the organisation row must exist)."""
    specs = specs or machine_specs()
    cats = {}
    for name, rate, _ in CATEGORIES:
        cats[name] = conn.execute("INSERT INTO equipment_categories (organisation_id, name) VALUES (%s,%s) RETURNING id", (organisation_id, name)).fetchone()
    plants, lines = {}, {}
    for spec in specs:
        if spec.plant_code not in plants:
            row = conn.execute("INSERT INTO plants (organisation_id, name, code, time_zone) VALUES (%s,%s,%s,'UTC') RETURNING id",
                               (organisation_id, spec.plant_name, spec.plant_code)).fetchone()
            plants[spec.plant_code] = _id(row)
            for shift_name, s, e in SHIFTS:
                conn.execute("INSERT INTO shifts (plant_id, name, start_time, end_time) VALUES (%s,%s,%s,%s)", (plants[spec.plant_code], shift_name, s, e))
        key = (spec.plant_code, spec.line_code)
        if key not in lines:
            row = conn.execute("INSERT INTO production_lines (plant_id, name, code) VALUES (%s,%s,%s) RETURNING id",
                               (plants[spec.plant_code], f"Line {spec.line_code[1:]}", spec.line_code)).fetchone()
            lines[key] = _id(row)
        conn.execute(
            "INSERT INTO equipment (production_line_id, category_id, asset_code, name, ideal_rate_per_hour) VALUES (%s,%s,%s,%s,%s)",
            (lines[key], _id(cats[spec.category]), spec.asset_code, f"{spec.category} {spec.asset_code}", spec.ideal_rate))


def _id(row) -> uuid.UUID:
    return row["id"] if isinstance(row, dict) else row[0]
