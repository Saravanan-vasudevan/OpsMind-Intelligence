// Verifies the V2 SQL (migration 002) against hand-computed numbers on a small fixed dataset.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
let db;
const id = {};

async function one(sql, params = []) { return (await db.query(sql, params)).rows[0].id; }
async function rejects(sql, params, code) {
  await assert.rejects(() => db.query(sql, params), (e) => { assert.equal(e.code, code, e.message); return true; });
}

async function production(eq, shift, date, units, run, inspected = null, rejected = null) {
  const rid = await one(
    `INSERT INTO production_records (equipment_id, shift_id, shift_date, units_produced, target_units, run_minutes)
     VALUES ($1,$2,$3,$4,$4,$5) RETURNING id`, [eq, shift, date, units, run]);
  if (inspected !== null) await db.query(`INSERT INTO quality_records (production_record_id, inspected_units, rejected_units) VALUES ($1,$2,$3)`, [rid, inspected, rejected]);
  return rid;
}
const downtime = (eq, start, end, category, reason) =>
  db.query(`INSERT INTO downtime_events (equipment_id, start_time, end_time, category, reason_code) VALUES ($1,$2,$3,$4,$5)`, [eq, start, end, category, reason]);

before(async () => {
  db = new PGlite();
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));

  id.org = await one(`INSERT INTO organisations (name) VALUES ('Org A') RETURNING id`);
  id.org2 = await one(`INSERT INTO organisations (name) VALUES ('Org B') RETURNING id`);
  id.cat = await one(`INSERT INTO equipment_categories (organisation_id, name) VALUES ($1,'Press') RETURNING id`, [id.org]);
  id.cat2 = await one(`INSERT INTO equipment_categories (organisation_id, name) VALUES ($1,'Press') RETURNING id`, [id.org2]);

  async function plant(org, cat, code) {
    const p = await one(`INSERT INTO plants (organisation_id, name, code) VALUES ($1,$2,$2) RETURNING id`, [org, code]);
    const l = await one(`INSERT INTO production_lines (plant_id, name, code) VALUES ($1,'L','L') RETURNING id`, [p]);
    const s = await one(`INSERT INTO shifts (plant_id, name, start_time, end_time) VALUES ($1,'Day','06:00','14:00') RETURNING id`, [p]);
    const mk = (code2) => one(`INSERT INTO equipment (production_line_id, category_id, asset_code, name) VALUES ($1,$2,$3,$3) RETURNING id`, [l, cat, code2]);
    return { p, l, s, mk };
  }
  const p1 = await plant(id.org, id.cat, 'P1');
  const p2 = await plant(id.org, id.cat, 'P2');
  const other = await plant(id.org2, id.cat2, 'X1');
  id.p1 = p1.p; id.shift1 = p1.s;
  id.A = await p1.mk('A'); id.B = await p1.mk('B');
  id.C = await p2.mk('C'); id.D = await p2.mk('D'); id.shift2 = p2.s;
  id.X = await other.mk('X');

  // A: 8 days from 2026-03-01 (a Sunday), 100 units each except day 8 = 200; run 400 of 480 scheduled; quality 100 inspected / 2 rejected
  for (let d = 1; d <= 8; d++) await production(id.A, id.shift1, `2026-03-0${d}`, d === 8 ? 200 : 100, 400, 100, 2);
  await production(id.A, id.shift1, '2026-03-20', 400, 400); // after a 12-day gap
  await production(id.B, id.shift1, '2026-03-01', 50, 400);
  // Downtime: two unplanned events on A on day 2 (60 + 30 min), one planned 45 min on day 3, B unplanned 120 on day 1
  await downtime(id.A, '2026-03-02T08:00Z', '2026-03-02T09:00Z', 'Unplanned', 'JAM');
  await downtime(id.A, '2026-03-02T12:00Z', '2026-03-02T12:30Z', 'Unplanned', 'SENSOR');
  await downtime(id.A, '2026-03-03T06:00Z', '2026-03-03T06:45Z', 'Planned', 'MAINT');
  await downtime(id.B, '2026-03-01T10:00Z', '2026-03-01T12:00Z', 'Unplanned', 'JAM');
  await downtime(id.A, '2026-03-15T08:00Z', '2026-03-15T09:00Z', 'Unplanned', 'JAM'); // day with no production record
  // Plant 2: C has 600 min unplanned downtime on a 480-minute shift; D has none
  await production(id.C, id.shift2, '2026-03-01', 10, 0);
  await production(id.D, id.shift2, '2026-03-01', 90, 450);
  await downtime(id.C, '2026-03-01T00:00Z', '2026-03-01T10:00Z', 'Unplanned', 'MECH');
  // Other organisation
  await production(id.X, other.s, '2026-03-01', 999, 480);
});

test('v_equipment_daily aggregates downtime and production separately (no row multiplication)', async () => {
  const r = (await db.query(`SELECT * FROM v_equipment_daily WHERE equipment_id = $1 AND day = '2026-03-02'`, [id.A])).rows;
  assert.equal(r.length, 1);
  assert.equal(Number(r[0].units), 100, 'two downtime events on the day must not double the production units');
  assert.equal(Number(r[0].unplanned_downtime_minutes), 90);
  assert.equal(r[0].failures, 2);
  assert.equal(Number(r[0].inspected_units), 100);
});

test('v_equipment_daily excludes days that have downtime but no production record', async () => {
  const r = await db.query(`SELECT 1 FROM v_equipment_daily WHERE equipment_id = $1 AND day = '2026-03-15'`, [id.A]);
  assert.equal(r.rows.length, 0);
});

test('trailing 7-day average is calendar based, not row based', async () => {
  const get = async (day) => Number((await db.query(`SELECT units_7d_avg FROM v_equipment_daily WHERE equipment_id=$1 AND day=$2`, [id.A, day])).rows[0].units_7d_avg);
  assert.equal(await get('2026-03-01'), 100);
  assert.equal(await get('2026-03-08'), 114.29); // days 2..8 = (6*100 + 200) / 7
  assert.equal(await get('2026-03-20'), 400);    // the previous row is 12 days earlier, outside the window
});

test('fn_equipment_reliability computes MTBF, MTTR, availability and per-plant Pareto', async () => {
  const rows = (await db.query(`SELECT * FROM fn_equipment_reliability($1, '2026-03-01', '2026-03-10') WHERE plant_name = 'P1' ORDER BY asset_code`, [id.org])).rows;
  const [a, b] = rows;
  assert.equal(a.asset_code, 'A');
  assert.equal(a.failures, 2);
  assert.equal(Number(a.unplanned_minutes), 90);
  assert.equal(Number(a.planned_minutes), 45);
  assert.equal(Number(a.run_minutes), 3200);
  assert.equal(Number(a.scheduled_minutes), 3840);
  assert.equal(Number(a.mtbf_minutes), 1600);
  assert.equal(Number(a.mttr_minutes), 45);
  assert.equal(Number(a.availability), 0.9763); // (3840-45-90)/(3840-45)
  assert.equal(b.asset_code, 'B');
  assert.equal(Number(b.mtbf_minutes), 400);
  assert.equal(Number(b.mttr_minutes), 120);
  assert.equal(Number(b.availability), 0.75);
  assert.equal(b.downtime_rank_in_plant, 1);
  assert.equal(a.downtime_rank_in_plant, 2);
  assert.equal(Number(b.pct_of_plant_unplanned), 57.1);
  assert.equal(Number(a.pct_of_plant_unplanned), 42.9);
  assert.equal(Number(b.cumulative_pct_of_plant), 57.1);
  assert.equal(Number(a.cumulative_pct_of_plant), 100);
});

test('reliability respects the date range (downtime on 15 March is outside 1–10 March)', async () => {
  const wide = (await db.query(`SELECT failures FROM fn_equipment_reliability($1,'2026-03-01','2026-03-31') WHERE asset_code='A'`, [id.org])).rows[0];
  assert.equal(wide.failures, 3);
});

test('availability is floored at zero and MTBF is null with no failures', async () => {
  const rows = (await db.query(`SELECT * FROM fn_equipment_reliability($1,'2026-03-01','2026-03-10') WHERE plant_name = 'P2' ORDER BY asset_code`, [id.org])).rows;
  const [c, d] = rows;
  assert.equal(Number(c.availability), 0);
  assert.equal(d.failures, 0);
  assert.equal(d.mtbf_minutes, null);
  assert.equal(d.mttr_minutes, null);
  assert.equal(Number(d.pct_of_plant_unplanned), 0);
});

test('reliability never returns another organisation\'s equipment', async () => {
  const mine = (await db.query(`SELECT asset_code FROM fn_equipment_reliability($1,'2026-03-01','2026-03-31')`, [id.org])).rows.map((r) => r.asset_code);
  assert.ok(!mine.includes('X'));
  const theirs = (await db.query(`SELECT asset_code FROM fn_equipment_reliability($1,'2026-03-01','2026-03-31')`, [id.org2])).rows.map((r) => r.asset_code);
  assert.deepEqual(theirs, ['X']);
});

test('bi.dim_date has one row per day with correct attributes', async () => {
  const r = (await db.query(`SELECT * FROM bi.dim_date WHERE date = '2026-03-01'`)).rows[0];
  assert.equal(r.date_key, 20260301);
  assert.equal(r.iso_day_of_week, 7); // Sunday
  assert.equal(r.is_weekend, true);
  assert.equal(r.year_month, '2026-03');
  const dup = (await db.query(`SELECT count(*)::int n FROM (SELECT date_key FROM bi.dim_date GROUP BY 1 HAVING count(*) > 1) x`)).rows[0].n;
  assert.equal(dup, 0);
});

test('star schema facts reconcile with the operational tables and join to every dimension', async () => {
  const q = async (sql) => (await db.query(sql)).rows[0];
  assert.equal((await q(`SELECT count(*)::int n FROM bi.fact_production`)).n, (await q(`SELECT count(*)::int n FROM production_records`)).n);
  assert.equal((await q(`SELECT sum(units_produced)::int n FROM bi.fact_production`)).n, (await q(`SELECT sum(units_produced)::int n FROM production_records`)).n);
  assert.equal(Number((await q(`SELECT sum(duration_minutes) n FROM bi.fact_downtime`)).n), Number((await q(`SELECT sum(duration_minutes) n FROM downtime_events`)).n));
  for (const [fact, dim, key] of [
    ['fact_production', 'dim_date', 'date_key'], ['fact_production', 'dim_equipment', 'equipment_id'], ['fact_production', 'dim_plant', 'plant_id'],
    ['fact_production', 'dim_line', 'line_id'], ['fact_production', 'dim_shift', 'shift_id'],
    ['fact_downtime', 'dim_date', 'date_key'], ['fact_downtime', 'dim_equipment', 'equipment_id'], ['fact_downtime', 'dim_plant', 'plant_id'],
  ]) {
    const orphans = (await q(`SELECT count(*)::int n FROM bi.${fact} f LEFT JOIN bi.${dim} d ON d.${key} = f.${key} WHERE d.${key} IS NULL`)).n;
    assert.equal(orphans, 0, `${fact}.${key} has rows with no ${dim}`);
  }
  const reasons = (await q(`SELECT count(*)::int n FROM bi.fact_downtime f LEFT JOIN bi.dim_downtime_reason r ON r.organisation_id = f.organisation_id AND r.category = f.category AND r.reason_code = f.reason_code WHERE r.reason_code IS NULL`)).n;
  assert.equal(reasons, 0);
});

test('bi.fact_downtime date_key uses the UTC start date', async () => {
  await downtime(id.D, '2026-03-04T23:30Z', '2026-03-05T00:30Z', 'Unplanned', 'LATE');
  const r = (await db.query(`SELECT date_key FROM bi.fact_downtime WHERE reason_code = 'LATE'`)).rows[0];
  assert.equal(r.date_key, 20260304);
});

test('import batch: one completed import per file+kind+policy, but failed attempts may be retried', async () => {
  const ins = (status, policy = 'skip') => db.query(
    `INSERT INTO import_batches (organisation_id, kind, file_name, file_sha256, source_format, conflict_policy, status)
     VALUES ($1,'production','a.csv',repeat('a',64),'csv',$2,$3) RETURNING id`, [id.org, policy, status]);
  await ins('Failed'); await ins('Failed'); await ins('Rejected');
  const done = await ins('Completed');
  assert.equal(done.rows.length, 1);
  await rejects(`INSERT INTO import_batches (organisation_id, kind, file_name, file_sha256, source_format, conflict_policy, status)
     VALUES ($1,'production','b.csv',repeat('a',64),'csv','skip','Completed')`, [id.org], '23505');
  await ins('Completed', 'update'); // different policy is a different import
});

test('import batch count and enum constraints', async () => {
  const base = `INSERT INTO import_batches (organisation_id, kind, file_name, file_sha256, source_format, conflict_policy, status, total_rows, inserted_rows)
                VALUES ($1,$2,'f',repeat('b',64),$3,'skip',$4,$5,$6)`;
  await rejects(base, [id.org, 'production', 'csv', 'Completed', 5, 6], '23514'); // inserted > total
  await rejects(base, [id.org, 'sales', 'csv', 'Completed', 5, 1], '23514');
  await rejects(base, [id.org, 'production', 'pdf', 'Completed', 5, 1], '23514');
  await rejects(base, [id.org, 'production', 'csv', 'Done', 5, 1], '23514');
});

test('production lineage: deleting a batch keeps the records and clears the link; errors cascade', async () => {
  const batch = await one(
    `INSERT INTO import_batches (organisation_id, kind, file_name, file_sha256, source_format, conflict_policy, status, total_rows, inserted_rows)
     VALUES ($1,'production','l.csv',repeat('c',64),'csv','skip','Completed',1,1) RETURNING id`, [id.org]);
  await db.query(`INSERT INTO import_errors (batch_id, row_number, code, message) VALUES ($1, 2, 'x', 'y')`, [batch]);
  const rec = await one(
    `INSERT INTO production_records (equipment_id, shift_id, shift_date, units_produced, target_units, run_minutes, import_batch_id)
     VALUES ($1,$2,'2026-04-01',1,1,1,$3) RETURNING id`, [id.D, id.shift2, batch]);
  await db.query(`DELETE FROM import_batches WHERE id = $1`, [batch]);
  const r = (await db.query(`SELECT import_batch_id FROM production_records WHERE id = $1`, [rec])).rows[0];
  assert.equal(r.import_batch_id, null);
  assert.equal((await db.query(`SELECT 1 FROM import_errors WHERE batch_id = $1`, [batch])).rows.length, 0);
});
