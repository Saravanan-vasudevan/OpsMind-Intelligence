// The EF Core model maps property names to snake_case columns by convention (see OpsMindDbContext.ApplySnakeCaseNames).
// This test migrates the real schema and checks every entity property has a column and every column has a property,
// so a model/schema drift is caught here instead of as a runtime SQL error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const domainDir = join(here, '..', '..', 'backend', 'src', 'OpsMind.Api', 'Domain');

const tableForEntity = {
  Organisation: 'organisations',
  User: 'users',
  Plant: 'plants',
  ProductionLine: 'production_lines',
  Shift: 'shifts',
  EquipmentCategory: 'equipment_categories',
  Equipment: 'equipment',
  ProductionRecord: 'production_records',
  QualityRecord: 'quality_records',
  DowntimeEvent: 'downtime_events',
  AuditLog: 'audit_logs',
  ImportBatch: 'import_batches',
  ImportError: 'import_errors',
};
const entityNames = new Set(Object.keys(tableForEntity));
const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function readEntities() {
  const result = {};
  for (const file of readdirSync(domainDir).filter((f) => f.endsWith('.cs'))) {
    const source = readFileSync(join(domainDir, file), 'utf8');
    for (const match of source.matchAll(/public class (\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
      const [, className, body] = match;
      if (!entityNames.has(className)) continue;
      const columns = new Set();
      for (const prop of body.matchAll(/public\s+([\w<>?,\[\]]+)\s+(\w+)\s*\{\s*get;\s*set;\s*\}/g)) {
        const type = prop[1].replace('?', '');
        if (entityNames.has(type) || type.startsWith('ICollection<')) continue; // navigation property
        columns.add(snake(prop[2]));
      }
      result[className] = columns;
    }
  }
  return result;
}

test('every EF entity property has a column and every column has a property', async () => {
  const db = new PGlite();
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  }

  const entities = readEntities();
  assert.deepEqual(Object.keys(entities).sort(), [...entityNames].sort(), 'all entities should be found in Domain/*.cs');

  for (const [entity, table] of Object.entries(tableForEntity)) {
    const rows = (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows;
    const dbColumns = new Set(rows.map((r) => r.column_name));
    const modelColumns = entities[entity];

    const missingInDb = [...modelColumns].filter((c) => !dbColumns.has(c));
    const missingInModel = [...dbColumns].filter((c) => !modelColumns.has(c));
    assert.deepEqual(missingInDb, [], `${entity}: model properties without a column in ${table}`);
    assert.deepEqual(missingInModel, [], `${entity}: columns in ${table} without a model property`);
  }
});
