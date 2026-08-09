import type Database from 'better-sqlite3';
const migrations = [
`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, business_summary TEXT, sector TEXT, website TEXT, board_size INTEGER, other_board_members TEXT, meeting_cadence TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('current','former','potential')), position_type TEXT NOT NULL CHECK(position_type IN ('governing_board','advisory_board','advisor')), start_date TEXT, end_date TEXT, expected_decision_date TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS compensation (id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', frequency TEXT NOT NULL CHECK(frequency IN ('one_time','annual','quarterly','monthly','per_meeting')), notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(position_id) REFERENCES positions(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS instrument_types (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company_id); CREATE INDEX IF NOT EXISTS idx_positions_status_decision ON positions(status, expected_decision_date); CREATE INDEX IF NOT EXISTS idx_compensation_position ON compensation(position_id);`,
`INSERT OR IGNORE INTO instrument_types(name) VALUES ('Stock'), ('Options'), ('RSU'), ('Warrant'), ('Profits Interest');`,
`CREATE TABLE compensation_v2 (id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'cash' CHECK(type IN ('cash','non_cash')), amount REAL, currency TEXT, frequency TEXT CHECK(frequency IS NULL OR frequency IN ('one_time','annual','quarterly','monthly','per_meeting')), instrument_type_id INTEGER, quantity REAL, grant_price REAL, grant_date TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(position_id) REFERENCES positions(id) ON DELETE CASCADE, FOREIGN KEY(instrument_type_id) REFERENCES instrument_types(id) ON DELETE RESTRICT, CHECK((type='cash' AND amount IS NOT NULL AND currency IS NOT NULL AND frequency IS NOT NULL AND instrument_type_id IS NULL AND quantity IS NULL) OR (type='non_cash' AND amount IS NULL AND currency IS NULL AND frequency IS NULL AND instrument_type_id IS NOT NULL AND quantity IS NOT NULL)));
 INSERT INTO compensation_v2 (id,position_id,type,amount,currency,frequency,notes,created_at,updated_at) SELECT id,position_id,'cash',amount,currency,frequency,notes,created_at,updated_at FROM compensation;
 DROP TABLE compensation;
 ALTER TABLE compensation_v2 RENAME TO compensation;
 CREATE INDEX IF NOT EXISTS idx_compensation_position ON compensation(position_id);
 CREATE INDEX IF NOT EXISTS idx_compensation_instrument_type ON compensation(instrument_type_id);
 ALTER TABLE instrument_types ADD COLUMN description TEXT;`,
`CREATE TABLE IF NOT EXISTS vesting_schedules (id INTEGER PRIMARY KEY, compensation_id INTEGER NOT NULL, schedule_type TEXT NOT NULL CHECK(schedule_type IN ('immediate','cliff_linear','milestone','custom')), cliff_date TEXT, vesting_start TEXT, vesting_end TEXT, cadence TEXT CHECK(cadence IS NULL OR cadence IN ('monthly','quarterly','annual','one_time')), notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(compensation_id) REFERENCES compensation(id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS idx_vesting_schedules_compensation ON vesting_schedules(compensation_id);`,
`CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, position_id INTEGER, compensation_id INTEGER, document_type TEXT NOT NULL, file_path TEXT, file_name TEXT, description TEXT, document_date TEXT, status TEXT NOT NULL CHECK(status IN ('linked','missing')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE, FOREIGN KEY(position_id) REFERENCES positions(id) ON DELETE SET NULL, FOREIGN KEY(compensation_id) REFERENCES compensation(id) ON DELETE SET NULL, CHECK((status='linked' AND file_path IS NOT NULL) OR (status='missing' AND file_path IS NULL)));
 CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
 CREATE INDEX IF NOT EXISTS idx_documents_position ON documents(position_id);
 CREATE INDEX IF NOT EXISTS idx_documents_compensation ON documents(compensation_id);
 CREATE INDEX IF NOT EXISTS idx_documents_status_company ON documents(status, company_id);`,
`CREATE TABLE IF NOT EXISTS import_batches (id INTEGER PRIMARY KEY, source_label TEXT NOT NULL, source_tool TEXT, source_reference TEXT, source_notes TEXT, schema_version INTEGER NOT NULL, generated_at TEXT, payload_json TEXT NOT NULL, summary_json TEXT, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 ALTER TABLE documents ADD COLUMN extracted_data_json TEXT;
 ALTER TABLE documents ADD COLUMN import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL;
 ALTER TABLE compensation ADD COLUMN extracted_data_json TEXT;
 ALTER TABLE compensation ADD COLUMN import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL;
 CREATE INDEX IF NOT EXISTS idx_documents_import_batch ON documents(import_batch_id);
 CREATE INDEX IF NOT EXISTS idx_compensation_import_batch ON compensation(import_batch_id);
 CREATE INDEX IF NOT EXISTS idx_import_batches_imported_at ON import_batches(imported_at DESC);`,
// v0.4.2: fields an extraction supplies that this schema has no column for are kept here rather
// than dropped. Companies, positions and vesting schedules previously had nowhere to put them.
`ALTER TABLE companies ADD COLUMN extracted_data_json TEXT;
 ALTER TABLE positions ADD COLUMN extracted_data_json TEXT;
 ALTER TABLE vesting_schedules ADD COLUMN extracted_data_json TEXT;`,
// v0.5.0: a company can be renamed (to carry a DBA, or because it actually changed names). Imports
// match companies by name, so every former name is remembered here — otherwise re-importing an
// agreement that still says "Kapalya Inc." would silently create a second company.
`CREATE TABLE IF NOT EXISTS company_aliases (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('rename','manual')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_company_aliases_name ON company_aliases(name COLLATE NOCASE);
 CREATE INDEX IF NOT EXISTS idx_company_aliases_company ON company_aliases(company_id);`,
// 9 — how long the award vests over. Agreements routinely state a term ("vesting over 48 months")
// without ever naming an end date, and percent-vested was uncomputable for every one of them.
`ALTER TABLE vesting_schedules ADD COLUMN duration_months INTEGER;`,
// 10 — the app used to re-import the seed companies on every launch, so a company you deleted came
// straight back the next time you opened it. Seeding is now recorded here and happens once. A
// database that already holds companies is treated as seeded, so upgrading never resurrects
// anything that was deleted before this migration ran.
`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 INSERT OR IGNORE INTO app_meta(key,value) SELECT 'seed_imported_at', CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM companies);`,
// 11 — deadlines. company_id is nullable because not every deadline belongs to a company, and
// position_id is SET NULL rather than CASCADE so deleting a position does not silently discard a
// dated obligation that still stands.
`CREATE TABLE IF NOT EXISTS deadlines (id INTEGER PRIMARY KEY, company_id INTEGER, position_id INTEGER, title TEXT NOT NULL, deadline_type TEXT NOT NULL CHECK(deadline_type IN ('board_meeting','decision','filing','document','review','payment','other')), due_date TEXT NOT NULL, notes TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE, FOREIGN KEY(position_id) REFERENCES positions(id) ON DELETE SET NULL);
 CREATE INDEX IF NOT EXISTS idx_deadlines_due ON deadlines(completed_at, due_date);
 CREATE INDEX IF NOT EXISTS idx_deadlines_company ON deadlines(company_id);
 CREATE INDEX IF NOT EXISTS idx_deadlines_position ON deadlines(position_id);`
];
/** How many migrations exist. Tests assert against this so a new migration does not break them. */
export const SCHEMA_VERSION = migrations.length;

export function runMigrations(db: Database.Database): void { db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'); const applied = new Set((db.prepare('SELECT version FROM schema_version').all() as { version: number }[]).map((row) => row.version)); migrations.forEach((sql, index) => { const version = index + 1; if (!applied.has(version)) db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(version); })(); }); }
