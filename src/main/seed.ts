import type { BoardTrackerDatabase } from './database';

export interface SeedImportResult { inserted: number; skipped: number; already_imported: boolean }

/**
 * Import the bundled sample companies at most once per database.
 *
 * This used to run unconditionally on every launch, which meant any seed company you deleted came
 * straight back the next time you opened the app: `INSERT OR IGNORE` only spares the rows that are
 * still present, so a deleted one looked like a missing row and was re-inserted. Recording that the
 * seed has been imported makes deleting permanent.
 *
 * `force` is the File › Import Seed Data menu item and the matching button, where deliberately
 * re-adding the samples is the whole point of choosing it.
 */
export function importSeedOnce(database: BoardTrackerDatabase, readSeed: () => unknown, force = false): SeedImportResult {
  if (!force && database.hasImportedSeed()) return { inserted: 0, skipped: 0, already_imported: true };
  const result = database.importSeedCompanies(readSeed() as never);
  database.setMeta('seed_imported_at', new Date().toISOString());
  return { ...result, already_imported: false };
}
