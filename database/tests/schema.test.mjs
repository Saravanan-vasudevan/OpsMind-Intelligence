// Runs the real SQL migrations on an in-process PostgreSQL (PGlite) and checks constraints and generated columns.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
let db;
let ids = {};

async function rejects(sql, params, code) {
  await assert.rejects(
    () => db.query(sql, params),
    (err) => {
      assert.equal(err.code, code, `expected SQLSTATE ${code}, got ${err.code}: ${err.message}`);
      return true;
    },
  );
}

before(async () => {
  db = new PGlite();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));

  const org = (await db.query(`INSERT INTO organisations (name) VALUES ('Org A') RETURNING id`)).rows[0].id;
  const plant = (await db.query(`INSERT INTO plants (organisation_id, name, code) VALUES ($1,'Plant 1','P1') RETURNING id`, [org])).rows[0].id;
  const line = (await db.query(`INSERT INTO production_lines (plant_id, name, code) VALUES ($1,'Line 1','L1') RETURNING id`, [plant])).rows[0].id;
  const cat = (await db.query(`INSERT INTO equipment_categories (organisation_id, name) VALUES ($1,'Press') RETURNING id`, [org])).rows[0].id;
  const eq = (await db.query(`INSERT INTO equipment (production_line_id, category_id, asset_code, name) VALUES ($1,$2,'M-01','Press 1') RETURNING id`, [line, cat])).rows[0].id;
  const shift = (await db.query(`INSERT INTO shifts (plant_id, name, start_time, end_time) VALUES ($1,'Day','06:00','14:00') RETURNING id`, [plant])).rows[0].id;
  ids = { org, plant, line, cat, eq, shift };
});

test('all migrations apply on an empty database', async () => {
  const r = await db.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  assert.equal(r.rows[0].n, 13);
});

test('shift duration is computed for day and overnight shifts', async () => {
  const night = (await db.query(
    `INSERT INTO shifts (plant_id, name, start_time, end_time) VALUES ($1,'Night','22:00','06:00') RETURNING duration_minutes`, [ids.plant])).rows[0];
  const day = (await db.query(`SELECT duration_minutes FROM shifts WHERE id = $1`, [ids.shift])).rows[0];
  assert.equal(day.duration_minutes, 480);
  assert.equal(night.duration_minutes, 480);
});

test('shift with identical start and end is rejected', async () => {
  await rejects(`INSERT INTO shifts (plant_id, name, start_time, end_time) VALUES ($1,'Bad','06:00','06:00')`, [ids.plant], '23514');
});

test('duplicate plant code within an organisation is rejected, same code in another organisation is allowed', async () => {
  await rejects(`INSERT INTO plants (organisation_id, name, code) VALUES ($1,'Other name','P1')`, [ids.org], '23505');
  const orgB = (await db.query(`INSERT INTO organisations (name) VALUES ('Org B') RETURNING id`)).rows[0].id;
  const r = await db.query(`INSERT INTO plants (organisation_id, name, code) VALUES ($1,'Plant 1','P1') RETURNING id`, [orgB]);
  assert.equal(r.rows.length, 1);
});

test('email uniqueness is case-insensitive', async () => {
  await db.query(`INSERT INTO users (organisation_id, email, password_hash, full_name, role) VALUES ($1,'a@x.com','h','A','Admin')`, [ids.org]);
  await rejects(`INSERT INTO users (organisation_id, email, password_hash, full_name, role) VALUES ($1,'A@X.com','h','A2','User')`, [ids.org], '23505');
});

test('invalid role is rejected', async () => {
  await rejects(`INSERT INTO users (organisation_id, email, password_hash, full_name, role) VALUES ($1,'b@x.com','h','B','Root')`, [ids.org], '23514');
});

test('production record: duplicate natural key and negative values are rejected', async () => {
  await db.query(`INSERT INTO production_records (equipment_id, shift_id, shift_date, units_produced, target_units, run_minutes) VALUES ($1,$2,'2026-01-05',400,450,420)`, [ids.eq, ids.shift]);
  await rejects(`INSERT INTO production_records (equipment_id, shift_id, shift_date, units_produced, target_units, run_minutes) VALUES ($1,$2,'2026-01-05',1,1,1)`, [ids.eq, ids.shift], '23505');
  await rejects(`INSERT INTO production_records (equipment_id, shift_id, shift_date, units_produced, target_units, run_minutes) VALUES ($1,$2,'2026-01-06',-1,1,1)`, [ids.eq, ids.shift], '23514');
});

test('quality: rejected cannot exceed inspected, one quality row per production record', async () => {
  const pr = (await db.query(`SELECT id FROM production_records LIMIT 1`)).rows[0].id;
  await rejects(`INSERT INTO quality_records (production_record_id, inspected_units, rejected_units) VALUES ($1,10,11)`, [pr], '23514');
  await db.query(`INSERT INTO quality_records (production_record_id, inspected_units, rejected_units) VALUES ($1,400,8)`, [pr]);
  await rejects(`INSERT INTO quality_records (production_record_id, inspected_units, rejected_units) VALUES ($1,1,0)`, [pr], '23505');
});

test('downtime duration is computed and invalid ranges are rejected', async () => {
  const r = await db.query(
    `INSERT INTO downtime_events (equipment_id, start_time, end_time, category, reason_code)
     VALUES ($1,'2026-01-05T08:00:00Z','2026-01-05T09:30:00Z','Unplanned','JAM') RETURNING duration_minutes`, [ids.eq]);
  assert.equal(Number(r.rows[0].duration_minutes), 90);
  await rejects(`INSERT INTO downtime_events (equipment_id, start_time, end_time, category, reason_code) VALUES ($1,'2026-01-05T10:00:00Z','2026-01-05T09:00:00Z','Unplanned','JAM')`, [ids.eq], '23514');
  await rejects(`INSERT INTO downtime_events (equipment_id, start_time, end_time, category, reason_code) VALUES ($1,'2026-01-05T11:00:00Z','2026-01-05T12:00:00Z','Sometimes','JAM')`, [ids.eq], '23514');
  await rejects(`INSERT INTO downtime_events (equipment_id, start_time, end_time, category, reason_code) VALUES ($1,'2026-01-05T08:00:00Z','2026-01-05T08:30:00Z','Unplanned','JAM')`, [ids.eq], '23505');
});

// ON DELETE RESTRICT reports 23001 (restrict_violation); a bad foreign key on INSERT reports 23503.
// The API error handler must map both to HTTP 409/400, so both are asserted here.
test('parents with children cannot be deleted (RESTRICT)', async () => {
  await rejects(`DELETE FROM plants WHERE id = $1`, [ids.plant], '23001');
  await rejects(`DELETE FROM equipment WHERE id = $1`, [ids.eq], '23001');
});

test('inserting a child with a missing parent is rejected', async () => {
  await rejects(`INSERT INTO production_lines (plant_id, name, code) VALUES (gen_random_uuid(),'X','X')`, [], '23503');
});

test('deleting a production record removes its quality record (CASCADE)', async () => {
  const pr = (await db.query(
    `INSERT INTO production_records (equipment_id, shift_id, shift_date, units_produced, target_units, run_minutes) VALUES ($1,$2,'2026-02-01',1,1,1) RETURNING id`, [ids.eq, ids.shift])).rows[0].id;
  await db.query(`INSERT INTO quality_records (production_record_id, inspected_units, rejected_units) VALUES ($1,1,0)`, [pr]);
  await db.query(`DELETE FROM production_records WHERE id = $1`, [pr]);
  const left = await db.query(`SELECT count(*)::int AS n FROM quality_records WHERE production_record_id = $1`, [pr]);
  assert.equal(left.rows[0].n, 0);
});
