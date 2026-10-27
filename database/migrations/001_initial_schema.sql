-- OpsMind schema, migration 001: tenancy, plant structure, equipment, production, downtime, quality, audit.
-- Applied by the backend's MigrationRunner (or manually with psql). Do not edit after release; add a new file.

CREATE TABLE organisations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_organisations_name UNIQUE (name),
    CONSTRAINT ck_organisations_name CHECK (length(btrim(name)) > 0)
);

CREATE TABLE users (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
    email            text NOT NULL,
    password_hash    text NOT NULL,
    full_name        text NOT NULL,
    role             text NOT NULL,
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_users_role CHECK (role IN ('Admin', 'User')),
    CONSTRAINT ck_users_email CHECK (position('@' IN email) > 1)
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));
CREATE INDEX ix_users_organisation ON users (organisation_id);

CREATE TABLE plants (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
    name             text NOT NULL,
    code             text NOT NULL,
    location         text,
    time_zone        text NOT NULL DEFAULT 'UTC',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_plants_org_code UNIQUE (organisation_id, code),
    CONSTRAINT uq_plants_org_name UNIQUE (organisation_id, name)
);

CREATE TABLE production_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id    uuid NOT NULL REFERENCES plants (id) ON DELETE RESTRICT,
    name        text NOT NULL,
    code        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_lines_plant_code UNIQUE (plant_id, code)
);

-- A shift may run past midnight (end_time < start_time); duration_minutes handles both cases.
CREATE TABLE shifts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id          uuid NOT NULL REFERENCES plants (id) ON DELETE RESTRICT,
    name              text NOT NULL,
    start_time        time NOT NULL,
    end_time          time NOT NULL,
    duration_minutes  integer GENERATED ALWAYS AS (
        ((EXTRACT(EPOCH FROM (end_time - start_time))::integer / 60) + 1440) % 1440
    ) STORED,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_shifts_plant_name UNIQUE (plant_id, name),
    CONSTRAINT ck_shifts_times CHECK (start_time <> end_time)
);

CREATE TABLE equipment_categories (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
    name             text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_categories_org_name UNIQUE (organisation_id, name)
);

CREATE TABLE equipment (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_line_id   uuid NOT NULL REFERENCES production_lines (id) ON DELETE RESTRICT,
    category_id          uuid NOT NULL REFERENCES equipment_categories (id) ON DELETE RESTRICT,
    asset_code           text NOT NULL,
    name                 text NOT NULL,
    ideal_rate_per_hour  numeric(10, 2),
    commissioned_on      date,
    status               text NOT NULL DEFAULT 'Active',
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_equipment_line_code UNIQUE (production_line_id, asset_code),
    CONSTRAINT ck_equipment_status CHECK (status IN ('Active', 'Inactive', 'Maintenance')),
    CONSTRAINT ck_equipment_rate CHECK (ideal_rate_per_hour IS NULL OR ideal_rate_per_hour > 0)
);
CREATE INDEX ix_equipment_category ON equipment (category_id);

CREATE TABLE production_records (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id   uuid NOT NULL REFERENCES equipment (id) ON DELETE RESTRICT,
    shift_id       uuid NOT NULL REFERENCES shifts (id) ON DELETE RESTRICT,
    shift_date     date NOT NULL,
    units_produced integer NOT NULL,
    target_units   integer NOT NULL,
    run_minutes    integer NOT NULL,
    notes          text,
    created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_production_equipment_shift_date UNIQUE (equipment_id, shift_id, shift_date),
    CONSTRAINT ck_production_units CHECK (units_produced >= 0),
    CONSTRAINT ck_production_target CHECK (target_units >= 0),
    CONSTRAINT ck_production_run CHECK (run_minutes >= 0)
);
CREATE INDEX ix_production_equipment_date ON production_records (equipment_id, shift_date);
CREATE INDEX ix_production_date ON production_records (shift_date);
CREATE INDEX ix_production_shift ON production_records (shift_id);

CREATE TABLE quality_records (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_record_id  uuid NOT NULL REFERENCES production_records (id) ON DELETE CASCADE,
    inspected_units       integer NOT NULL,
    rejected_units        integer NOT NULL,
    defect_type           text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_quality_production UNIQUE (production_record_id),
    CONSTRAINT ck_quality_counts CHECK (inspected_units >= 0 AND rejected_units >= 0 AND rejected_units <= inspected_units)
);

CREATE TABLE downtime_events (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id      uuid NOT NULL REFERENCES equipment (id) ON DELETE RESTRICT,
    start_time        timestamptz NOT NULL,
    end_time          timestamptz NOT NULL,
    duration_minutes  numeric(12, 2) GENERATED ALWAYS AS (
        round(EXTRACT(EPOCH FROM (end_time - start_time))::numeric / 60, 2)
    ) STORED,
    category          text NOT NULL,
    reason_code       text NOT NULL,
    notes             text,
    created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_downtime_equipment_start UNIQUE (equipment_id, start_time),
    CONSTRAINT ck_downtime_category CHECK (category IN ('Planned', 'Unplanned')),
    CONSTRAINT ck_downtime_times CHECK (end_time > start_time)
);
CREATE INDEX ix_downtime_start ON downtime_events (start_time);
CREATE INDEX ix_downtime_reason ON downtime_events (reason_code);

CREATE TABLE audit_logs (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organisation_id  uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
    user_id          uuid REFERENCES users (id) ON DELETE SET NULL,
    action           text NOT NULL,
    entity           text NOT NULL,
    entity_id        text,
    details          jsonb,
    ip_address       text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_org_created ON audit_logs (organisation_id, created_at DESC);
