"""Database side of the import: reference lookups, conflict classification and bulk writes.

Every query is scoped through the organisation's own plants, and rows are only written for equipment ids that
came from that lookup, so one organisation's file can never touch another's data.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import timedelta

import numpy as np
import pandas as pd
import psycopg

from .errors import RowError
from .validate import Lookups


def load_lookups(conn: psycopg.Connection, organisation_id: uuid.UUID) -> Lookups:
    equipment = conn.execute(
        """SELECT pl.code AS plant_code, ln.code AS line_code, e.asset_code, e.id AS equipment_id, pl.id AS plant_id, e.status
           FROM equipment e
           JOIN production_lines ln ON ln.id = e.production_line_id
           JOIN plants pl ON pl.id = ln.plant_id
           WHERE pl.organisation_id = %s""", (organisation_id,)).fetchall()
    shifts = conn.execute(
        """SELECT s.plant_id, s.name AS shift_name, s.id AS shift_id, s.duration_minutes
           FROM shifts s JOIN plants pl ON pl.id = s.plant_id WHERE pl.organisation_id = %s""", (organisation_id,)).fetchall()
    eq_cols = ["plant_code", "line_code", "asset_code", "equipment_id", "plant_id", "status"]
    sh_cols = ["plant_id", "shift_name", "shift_id", "duration_minutes"]
    return Lookups(
        equipment=pd.DataFrame(equipment, columns=eq_cols) if equipment else pd.DataFrame({c: pd.Series(dtype=object) for c in eq_cols}),
        shifts=pd.DataFrame(shifts, columns=sh_cols) if shifts else pd.DataFrame({c: pd.Series(dtype=object) for c in sh_cols}),
    )


@dataclass
class Plan:
    """What an import will do, decided before anything is written."""
    to_insert: pd.DataFrame
    to_update: pd.DataFrame            # carries `existing_id`
    unchanged: int = 0                 # rows that exist already (skip policy, or update policy with identical values)
    errors: list[RowError] = field(default_factory=list)


def _nullable(value):
    return None if pd.isna(value) else value


# ---- production -----------------------------------------------------------------------------------

def plan_production(conn: psycopg.Connection, valid: pd.DataFrame, policy: str) -> Plan:
    if valid.empty:
        return Plan(valid.copy(), valid.copy())
    rows = conn.execute(
        """SELECT p.id AS existing_id, p.equipment_id, p.shift_id, p.shift_date AS existing_date,
                  p.units_produced AS e_units, p.target_units AS e_target, p.run_minutes AS e_run, p.notes AS e_notes,
                  q.inspected_units AS e_inspected, q.rejected_units AS e_rejected, q.defect_type AS e_defect
           FROM production_records p LEFT JOIN quality_records q ON q.production_record_id = p.id
           WHERE p.equipment_id = ANY(%s) AND p.shift_date BETWEEN %s AND %s""",
        (list(valid["equipment_id"].unique()), valid["shift_date"].min(), valid["shift_date"].max())).fetchall()
    existing = pd.DataFrame(rows, columns=[
        "existing_id", "equipment_id", "shift_id", "existing_date", "e_units", "e_target", "e_run", "e_notes",
        "e_inspected", "e_rejected", "e_defect"])
    if existing.empty:
        return Plan(valid.copy(), valid.iloc[0:0].assign(existing_id=pd.Series(dtype=object)))

    merged = valid.merge(existing, left_on=["equipment_id", "shift_id", "shift_date"],
                         right_on=["equipment_id", "shift_id", "existing_date"], how="left")
    is_new = merged["existing_id"].isna().to_numpy()
    to_insert = merged[is_new][valid.columns]
    conflicts = merged[~is_new]
    if policy == "skip" or conflicts.empty:
        return Plan(to_insert, conflicts.iloc[0:0], unchanged=len(conflicts))

    def same(a, b):
        """Equal, or both missing. Comparisons involving <NA> give <NA>, which must count as 'not equal'."""
        return ((a == b).fillna(False).astype(bool)) | (a.isna() & b.isna())

    identical = (
        same(conflicts["units_produced"], conflicts["e_units"]) & same(conflicts["target_units"], conflicts["e_target"])
        & same(conflicts["run_minutes"], conflicts["e_run"]) & same(conflicts["notes"], conflicts["e_notes"])
        & same(conflicts["inspected_units"], conflicts["e_inspected"]) & same(conflicts["rejected_units"], conflicts["e_rejected"])
        & same(conflicts["defect_type"], conflicts["e_defect"])
    )
    return Plan(to_insert, conflicts[~identical.astype(bool).to_numpy()][list(valid.columns) + ["existing_id"]], unchanged=int(identical.sum()))


def write_production(conn: psycopg.Connection, plan: Plan, batch_id: uuid.UUID, user_id: uuid.UUID | None) -> None:
    with conn.cursor() as cur:
        inserts, qualities = [], []
        for r in plan.to_insert.itertuples(index=False):
            rid = uuid.uuid4()
            inserts.append((rid, r.equipment_id, r.shift_id, r.shift_date, int(r.units_produced), int(r.target_units),
                            int(r.run_minutes), _nullable(r.notes), user_id, batch_id))
            if pd.notna(r.inspected_units):
                qualities.append((uuid.uuid4(), rid, int(r.inspected_units), int(r.rejected_units), _nullable(r.defect_type)))
        if inserts:
            cur.executemany(
                """INSERT INTO production_records (id, equipment_id, shift_id, shift_date, units_produced, target_units,
                       run_minutes, notes, created_by, import_batch_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", inserts)
        if qualities:
            cur.executemany(
                "INSERT INTO quality_records (id, production_record_id, inspected_units, rejected_units, defect_type) VALUES (%s,%s,%s,%s,%s)",
                qualities)

        for r in plan.to_update.itertuples(index=False):
            cur.execute(
                """UPDATE production_records SET units_produced=%s, target_units=%s, run_minutes=%s, notes=%s,
                       import_batch_id=%s, updated_at=now() WHERE id=%s""",
                (int(r.units_produced), int(r.target_units), int(r.run_minutes), _nullable(r.notes), batch_id, r.existing_id))
            cur.execute("DELETE FROM quality_records WHERE production_record_id=%s", (r.existing_id,))
            if pd.notna(r.inspected_units):
                cur.execute(
                    "INSERT INTO quality_records (id, production_record_id, inspected_units, rejected_units, defect_type) VALUES (%s,%s,%s,%s,%s)",
                    (uuid.uuid4(), r.existing_id, int(r.inspected_units), int(r.rejected_units), _nullable(r.defect_type)))


# ---- downtime ------------------------------------------------------------------------------------

def plan_downtime(conn: psycopg.Connection, valid: pd.DataFrame, policy: str) -> Plan:
    if valid.empty:
        return Plan(valid.copy(), valid.copy())
    rows = conn.execute(
        """SELECT id AS existing_id, equipment_id, start_time AS e_start, end_time AS e_end, category AS e_category,
                  reason_code AS e_reason, notes AS e_notes
           FROM downtime_events WHERE equipment_id = ANY(%s) AND end_time >= %s AND start_time <= %s""",
        (list(valid["equipment_id"].unique()), valid["start_time"].min() - timedelta(days=1), valid["end_time"].max())).fetchall()
    existing = pd.DataFrame(rows, columns=["existing_id", "equipment_id", "e_start", "e_end", "e_category", "e_reason", "e_notes"])

    errors: list[RowError] = []
    insert_idx, update_idx, unchanged = [], [], 0
    existing_by_eq = {k: g for k, g in existing.groupby("equipment_id")} if not existing.empty else {}

    for equipment_id, group in valid.groupby("equipment_id", sort=False):
        ex = existing_by_eq.get(equipment_id)
        if ex is None:
            insert_idx.extend(group.index)
            continue
        ex_start = np.array([t.timestamp() for t in ex["e_start"]])
        ex_end = np.array([t.timestamp() for t in ex["e_end"]])
        s = np.array([t.timestamp() for t in group["start_time"]])
        e = np.array([t.timestamp() for t in group["end_time"]])
        same_start = ex_start[None, :] == s[:, None]
        overlap = ((ex_start[None, :] < e[:, None]) & (ex_end[None, :] > s[:, None]) & ~same_start).any(axis=1)
        has_same = same_start.any(axis=1)
        for k, (idx, row) in enumerate(group.iterrows()):
            if overlap[k]:
                errors.append(RowError(int(row["row_number"]), "start_time", "overlaps_existing",
                                       "Overlaps a downtime event already stored for this equipment."))
            elif not has_same[k]:
                insert_idx.append(idx)
            elif policy == "skip":
                unchanged += 1
            else:
                match = ex.iloc[int(np.flatnonzero(same_start[k])[0])]
                if (match["e_end"] == row["end_time"] and match["e_category"] == row["category"]
                        and match["e_reason"] == row["reason_code"] and (match["e_notes"] or None) == (row["notes"] if pd.notna(row["notes"]) else None)):
                    unchanged += 1
                else:
                    update_idx.append((idx, match["existing_id"]))

    to_update = valid.loc[[i for i, _ in update_idx]].copy()
    to_update["existing_id"] = [x for _, x in update_idx]
    return Plan(valid.loc[insert_idx], to_update, unchanged=unchanged, errors=errors)


def write_downtime(conn: psycopg.Connection, plan: Plan, batch_id: uuid.UUID, user_id: uuid.UUID | None) -> None:
    with conn.cursor() as cur:
        inserts = [(uuid.uuid4(), r.equipment_id, r.start_time, r.end_time, r.category, r.reason_code, _nullable(r.notes), user_id, batch_id)
                   for r in plan.to_insert.itertuples(index=False)]
        if inserts:
            cur.executemany(
                """INSERT INTO downtime_events (id, equipment_id, start_time, end_time, category, reason_code, notes, created_by, import_batch_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""", inserts)
        for r in plan.to_update.itertuples(index=False):
            cur.execute(
                """UPDATE downtime_events SET end_time=%s, category=%s, reason_code=%s, notes=%s, import_batch_id=%s, updated_at=now() WHERE id=%s""",
                (r.end_time, r.category, r.reason_code, _nullable(r.notes), batch_id, r.existing_id))
