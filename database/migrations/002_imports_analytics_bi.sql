-- OpsMind schema, migration 002 (V2 data intelligence): import history, analytics views/functions, Power BI star schema.
-- Additive only: nothing from 001 is altered except two nullable lineage columns.

-- ---------------------------------------------------------------------------------------------
-- Import history (written by the Python ETL service, read by the API)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE import_batches (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id   uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
    kind              text NOT NULL,
    file_name         text NOT NULL,
    file_sha256       char(64) NOT NULL,
    source_format     text NOT NULL,
    conflict_policy   text NOT NULL,
    strict            boolean NOT NULL DEFAULT false,
    status            text NOT NULL,
    total_rows        integer NOT NULL DEFAULT 0,
    inserted_rows     integer NOT NULL DEFAULT 0,
    updated_rows      integer NOT NULL DEFAULT 0,
    skipped_rows      integer NOT NULL DEFAULT 0,
    rejected_rows     integer NOT NULL DEFAULT 0,
    errors_truncated  boolean NOT NULL DEFAULT false,
    message           text,
    created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
    started_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    CONSTRAINT ck_import_kind CHECK (kind IN ('production', 'downtime')),
    CONSTRAINT ck_import_format CHECK (source_format IN ('csv', 'xlsx')),
    CONSTRAINT ck_import_policy CHECK (conflict_policy IN ('skip', 'update')),
    CONSTRAINT ck_import_status CHECK (status IN ('Completed', 'Rejected', 'Failed')),
    CONSTRAINT ck_import_counts CHECK (
        total_rows >= 0 AND inserted_rows >= 0 AND updated_rows >= 0 AND skipped_rows >= 0 AND rejected_rows >= 0
        AND inserted_rows + updated_rows + skipped_rows + rejected_rows <= total_rows)
);
-- Idempotency: the same file (by content hash) can be completed only once per kind and conflict policy.
-- Failed or rejected attempts do not block a corrected retry of the same bytes.
CREATE UNIQUE INDEX uq_import_completed_file
    ON import_batches (organisation_id, kind, file_sha256, conflict_policy) WHERE status = 'Completed';
CREATE INDEX ix_import_org_started ON import_batches (organisation_id, started_at DESC);

CREATE TABLE import_errors (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id     uuid NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
    row_number   integer NOT NULL,
    column_name  text,
    code         text NOT NULL,
    message      text NOT NULL,
    raw_value    text,
    CONSTRAINT ck_import_error_row CHECK (row_number >= 0)
);
CREATE INDEX ix_import_errors_batch ON import_errors (batch_id, row_number);

-- Lineage: which import created a record (null for records entered by hand or seeded).
ALTER TABLE production_records ADD COLUMN import_batch_id uuid REFERENCES import_batches (id) ON DELETE SET NULL;
ALTER TABLE downtime_events    ADD COLUMN import_batch_id uuid REFERENCES import_batches (id) ON DELETE SET NULL;
CREATE INDEX ix_production_import ON production_records (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX ix_downtime_import ON downtime_events (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Equipment-day facts. Production and downtime are aggregated separately in CTEs and joined at the
-- equipment-day grain; joining the two raw tables directly would multiply rows and inflate sums.
-- Downtime is attributed to the UTC date of its start (same rule as the API). Days with downtime but
-- no production record are not in this view (documented limitation).
-- ---------------------------------------------------------------------------------------------
CREATE VIEW v_equipment_daily AS
WITH prod AS (
    SELECT p.equipment_id,
           p.shift_date                          AS day,
           count(*)::integer                     AS records,
           sum(p.units_produced)::bigint         AS units,
           sum(p.target_units)::bigint           AS target_units,
           sum(p.run_minutes)::bigint            AS run_minutes,
           sum(s.duration_minutes)::bigint       AS scheduled_minutes,
           sum(q.inspected_units)::bigint        AS inspected_units,
           sum(q.rejected_units)::bigint         AS rejected_units
    FROM production_records p
    JOIN shifts s ON s.id = p.shift_id
    LEFT JOIN quality_records q ON q.production_record_id = p.id
    GROUP BY p.equipment_id, p.shift_date
), down AS (
    SELECT d.equipment_id,
           (d.start_time AT TIME ZONE 'UTC')::date                                  AS day,
           COALESCE(sum(d.duration_minutes) FILTER (WHERE d.category = 'Planned'), 0)    AS planned_downtime_minutes,
           COALESCE(sum(d.duration_minutes) FILTER (WHERE d.category = 'Unplanned'), 0)  AS unplanned_downtime_minutes,
           (count(*) FILTER (WHERE d.category = 'Unplanned'))::integer                   AS failures
    FROM downtime_events d
    GROUP BY d.equipment_id, (d.start_time AT TIME ZONE 'UTC')::date
)
SELECT pl.organisation_id,
       pl.id  AS plant_id,
       ln.id  AS line_id,
       e.id   AS equipment_id,
       e.asset_code,
       pr.day,
       pr.records,
       pr.units,
       pr.target_units,
       pr.run_minutes,
       pr.scheduled_minutes,
       pr.inspected_units,
       pr.rejected_units,
       COALESCE(dn.planned_downtime_minutes, 0)   AS planned_downtime_minutes,
       COALESCE(dn.unplanned_downtime_minutes, 0) AS unplanned_downtime_minutes,
       COALESCE(dn.failures, 0)                   AS failures,
       -- Calendar-aware trailing 7-day average (RANGE on a date, not "last 7 rows"), per machine.
       round(avg(pr.units) OVER (
           PARTITION BY e.id ORDER BY pr.day
           RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW), 2)             AS units_7d_avg
FROM prod pr
JOIN equipment e         ON e.id = pr.equipment_id
JOIN production_lines ln ON ln.id = e.production_line_id
JOIN plants pl           ON pl.id = ln.plant_id
LEFT JOIN down dn        ON dn.equipment_id = pr.equipment_id AND dn.day = pr.day;

-- ---------------------------------------------------------------------------------------------
-- Equipment reliability for a date range (CTEs + window functions).
--   MTBF = run minutes / failures (operating time between unplanned failures); null when no failure.
--   MTTR = unplanned downtime minutes / failures.
--   availability uses the same formula as the API KPI (planned downtime excluded, floored at 0).
--   rank / share / cumulative share are window functions per plant (a Pareto of machines).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION fn_equipment_reliability(p_org uuid, p_from date, p_to date)
RETURNS TABLE (
    equipment_id               uuid,
    asset_code                 text,
    equipment_name             text,
    plant_id                   uuid,
    plant_name                 text,
    line_name                  text,
    failures                   integer,
    unplanned_minutes          numeric,
    planned_minutes            numeric,
    run_minutes                bigint,
    scheduled_minutes          bigint,
    mtbf_minutes               numeric,
    mttr_minutes               numeric,
    availability               numeric,
    downtime_rank_in_plant     integer,
    pct_of_plant_unplanned     numeric,
    cumulative_pct_of_plant    numeric
)
LANGUAGE sql STABLE AS $$
WITH scope AS (
    SELECT e.id, e.asset_code, e.name, pl.id AS plant_id, pl.name AS plant_name, ln.name AS line_name
    FROM equipment e
    JOIN production_lines ln ON ln.id = e.production_line_id
    JOIN plants pl ON pl.id = ln.plant_id
    WHERE pl.organisation_id = p_org
), run AS (
    SELECT p.equipment_id,
           sum(p.run_minutes)::bigint AS run_minutes,
           sum(s.duration_minutes)::bigint AS scheduled_minutes
    FROM production_records p JOIN shifts s ON s.id = p.shift_id
    WHERE p.shift_date BETWEEN p_from AND p_to
    GROUP BY p.equipment_id
), dt AS (
    SELECT d.equipment_id,
           (count(*) FILTER (WHERE d.category = 'Unplanned'))::integer AS failures,
           COALESCE(sum(d.duration_minutes) FILTER (WHERE d.category = 'Unplanned'), 0) AS unplanned_minutes,
           COALESCE(sum(d.duration_minutes) FILTER (WHERE d.category = 'Planned'), 0)   AS planned_minutes
    FROM downtime_events d
    WHERE (d.start_time AT TIME ZONE 'UTC')::date BETWEEN p_from AND p_to
    GROUP BY d.equipment_id
), joined AS (
    SELECT sc.*, COALESCE(r.run_minutes, 0) AS run_minutes, COALESCE(r.scheduled_minutes, 0) AS scheduled_minutes,
           COALESCE(t.failures, 0) AS failures, COALESCE(t.unplanned_minutes, 0) AS unplanned_minutes,
           COALESCE(t.planned_minutes, 0) AS planned_minutes
    FROM scope sc
    LEFT JOIN run r ON r.equipment_id = sc.id
    LEFT JOIN dt  t ON t.equipment_id = sc.id
    WHERE r.equipment_id IS NOT NULL OR t.equipment_id IS NOT NULL
)
SELECT j.id, j.asset_code, j.name, j.plant_id, j.plant_name, j.line_name,
       j.failures,
       j.unplanned_minutes,
       j.planned_minutes,
       j.run_minutes,
       j.scheduled_minutes,
       round(j.run_minutes::numeric / NULLIF(j.failures, 0), 1),
       round(j.unplanned_minutes / NULLIF(j.failures, 0), 1),
       CASE WHEN j.scheduled_minutes - j.planned_minutes > 0
            THEN round(GREATEST(0, (j.scheduled_minutes - j.planned_minutes - j.unplanned_minutes)
                                   / (j.scheduled_minutes - j.planned_minutes)), 4) END,
       (rank() OVER (PARTITION BY j.plant_id ORDER BY j.unplanned_minutes DESC))::integer,
       round(100 * j.unplanned_minutes / NULLIF(sum(j.unplanned_minutes) OVER (PARTITION BY j.plant_id), 0), 1),
       round(100 * sum(j.unplanned_minutes) OVER (PARTITION BY j.plant_id ORDER BY j.unplanned_minutes DESC, j.id)
                 / NULLIF(sum(j.unplanned_minutes) OVER (PARTITION BY j.plant_id), 0), 1)
FROM joined j
ORDER BY j.plant_name, j.unplanned_minutes DESC, j.asset_code
$$;

-- ---------------------------------------------------------------------------------------------
-- Power BI star schema. Read-only views in their own schema. Every table carries organisation_id so a
-- report can be restricted to one organisation (Power BI has no tenant filter of its own).
-- Grain: fact_production = one production record; fact_downtime = one downtime event.
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA bi;

CREATE VIEW bi.dim_date AS
SELECT (to_char(d, 'YYYYMMDD'))::integer AS date_key,
       d::date                           AS date,
       extract(year FROM d)::integer     AS year,
       extract(quarter FROM d)::integer  AS quarter,
       extract(month FROM d)::integer    AS month_number,
       to_char(d, 'Mon')                 AS month_name,
       to_char(d, 'YYYY-MM')             AS year_month,
       extract(isoyear FROM d)::integer  AS iso_year,
       extract(week FROM d)::integer     AS iso_week,
       extract(isodow FROM d)::integer   AS iso_day_of_week,
       to_char(d, 'Dy')                  AS day_name,
       extract(isodow FROM d) >= 6       AS is_weekend
FROM generate_series(date '2020-01-01', date '2035-12-31', interval '1 day') AS g(d);

CREATE VIEW bi.dim_plant AS
SELECT id AS plant_id, organisation_id, name AS plant_name, code AS plant_code, location, time_zone
FROM plants;

CREATE VIEW bi.dim_line AS
SELECT ln.id AS line_id, pl.organisation_id, pl.id AS plant_id, ln.name AS line_name, ln.code AS line_code
FROM production_lines ln JOIN plants pl ON pl.id = ln.plant_id;

CREATE VIEW bi.dim_equipment AS
SELECT e.id AS equipment_id, pl.organisation_id, pl.id AS plant_id, ln.id AS line_id,
       e.asset_code, e.name AS equipment_name, c.name AS category_name, e.status, e.ideal_rate_per_hour, e.commissioned_on
FROM equipment e
JOIN production_lines ln ON ln.id = e.production_line_id
JOIN plants pl ON pl.id = ln.plant_id
JOIN equipment_categories c ON c.id = e.category_id;

CREATE VIEW bi.dim_shift AS
SELECT s.id AS shift_id, pl.organisation_id, pl.id AS plant_id, s.name AS shift_name,
       s.start_time, s.end_time, s.duration_minutes
FROM shifts s JOIN plants pl ON pl.id = s.plant_id;

CREATE VIEW bi.dim_downtime_reason AS
SELECT pl.organisation_id, d.category, d.reason_code
FROM downtime_events d
JOIN equipment e ON e.id = d.equipment_id
JOIN production_lines ln ON ln.id = e.production_line_id
JOIN plants pl ON pl.id = ln.plant_id
GROUP BY pl.organisation_id, d.category, d.reason_code;

CREATE VIEW bi.fact_production AS
SELECT p.id AS production_record_id,
       pl.organisation_id,
       (to_char(p.shift_date, 'YYYYMMDD'))::integer AS date_key,
       pl.id AS plant_id, ln.id AS line_id, p.equipment_id, p.shift_id,
       p.units_produced, p.target_units, p.run_minutes,
       s.duration_minutes AS scheduled_minutes,
       q.inspected_units, q.rejected_units, q.defect_type
FROM production_records p
JOIN equipment e ON e.id = p.equipment_id
JOIN production_lines ln ON ln.id = e.production_line_id
JOIN plants pl ON pl.id = ln.plant_id
JOIN shifts s ON s.id = p.shift_id
LEFT JOIN quality_records q ON q.production_record_id = p.id;

CREATE VIEW bi.fact_downtime AS
SELECT d.id AS downtime_event_id,
       pl.organisation_id,
       (to_char(d.start_time AT TIME ZONE 'UTC', 'YYYYMMDD'))::integer AS date_key,
       pl.id AS plant_id, ln.id AS line_id, d.equipment_id,
       d.category, d.reason_code,
       d.start_time, d.end_time, d.duration_minutes
FROM downtime_events d
JOIN equipment e ON e.id = d.equipment_id
JOIN production_lines ln ON ln.id = e.production_line_id
JOIN plants pl ON pl.id = ln.plant_id;
