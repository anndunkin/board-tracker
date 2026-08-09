import Database from 'better-sqlite3';
import { commitImport, previewImport } from './importer';
import { parseImportFile } from './import-schema';
import { runMigrations } from './migrations';
import { calculateVestingSummary } from './vesting';
import { positiveId, validateCompensation, validateCompany, validateDocument, validateInstrumentType, validatePosition, validateVestingSchedule, ValidationError } from './validation';
import type { Company, CompanyAlias, CompanyDetail, CompanyInput, Compensation, CompensationInput, DashboardData, Document, DocumentInput, ImportBatch, ImportPlan, ImportSelections, InstrumentType, InstrumentTypeInput, Position, PositionInput, UpcomingVesting, VestingSchedule, VestingScheduleInput } from '../shared/types';

export class BoardTrackerDatabase {
  readonly db: Database.Database;
  constructor(path: string) { this.db = new Database(path); this.db.pragma('foreign_keys = ON'); this.db.pragma('journal_mode = WAL'); runMigrations(this.db); }
  close(): void { this.db.close(); }
  private one<T>(sql: string, ...params: unknown[]): T { return this.db.prepare(sql).get(...params) as T; }
  private ensureChange(info: Database.RunResult, label: string): void { if (!info.changes) throw new ValidationError(`${label} was not found.`); }
  private duplicate(error: unknown, label: string): never { if (String(error).includes('UNIQUE')) throw new ValidationError(`A ${label} with this name already exists.`); throw error; }

  listCompanies(search = ''): Company[] { const term = typeof search === 'string' ? search.trim().slice(0, 200) : ''; return this.db.prepare(`SELECT c.*, COUNT(p.id) AS position_count FROM companies c LEFT JOIN positions p ON p.company_id=c.id WHERE c.name LIKE ? ESCAPE '\\' GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all(`%${term.replace(/[\\%_]/g, '\\$&')}%`) as Company[]; }
  getCompany(id: number): CompanyDetail | null {
    const company = this.db.prepare('SELECT c.*, COUNT(p.id) AS position_count FROM companies c LEFT JOIN positions p ON p.company_id=c.id WHERE c.id=? GROUP BY c.id').get(positiveId(id, 'Company')) as Company | undefined;
    if (!company) return null;
    const positions = this.db.prepare("SELECT * FROM positions WHERE company_id=? ORDER BY CASE status WHEN 'current' THEN 1 WHEN 'potential' THEN 2 ELSE 3 END, start_date DESC, id DESC").all(company.id) as Position[];
    const byPosition = this.db.prepare('SELECT compensation.*, instrument_types.name AS instrument_type_name FROM compensation LEFT JOIN instrument_types ON instrument_types.id=compensation.instrument_type_id WHERE compensation.position_id=? ORDER BY compensation.id DESC');
    const activeSchedule = this.db.prepare('SELECT * FROM vesting_schedules WHERE compensation_id=? ORDER BY id DESC LIMIT 1');
    const documents = this.db.prepare('SELECT documents.*, positions.status AS position_status, positions.position_type, compensation.type AS compensation_type, compensation.quantity AS compensation_quantity, instrument_types.name AS instrument_type_name FROM documents LEFT JOIN positions ON positions.id=documents.position_id LEFT JOIN compensation ON compensation.id=documents.compensation_id LEFT JOIN instrument_types ON instrument_types.id=compensation.instrument_type_id WHERE documents.company_id=? ORDER BY documents.status DESC, documents.document_date IS NULL, documents.document_date DESC, documents.id DESC').all(company.id) as Document[];
    const aliases = this.db.prepare('SELECT * FROM company_aliases WHERE company_id=? ORDER BY created_at DESC, id DESC').all(company.id) as CompanyAlias[];
    return { ...company, aliases, positions: positions.map((position) => ({ ...position, compensation: (byPosition.all(position.id) as Compensation[]).map((compensation) => (((active_vesting_schedule) => ({ ...compensation, active_vesting_schedule, vesting_summary: active_vesting_schedule ? calculateVestingSummary(active_vesting_schedule) : undefined }))((activeSchedule.get(compensation.id) as VestingSchedule | undefined) ?? null))) })), documents };
  }
  createCompany(input: CompanyInput): Company { const v = validateCompany(input); try { const result = this.db.prepare('INSERT INTO companies (name,business_summary,sector,website,board_size,other_board_members,meeting_cadence,notes) VALUES (@name,@business_summary,@sector,@website,@board_size,@other_board_members,@meeting_cadence,@notes)').run(v); return this.getCompany(result.lastInsertRowid as number)!; } catch (error) { return this.duplicate(error, 'company'); } }
  updateCompany(id: number, input: CompanyInput): Company {
    const v = validateCompany(input);
    const companyId = positiveId(id, 'Company');
    const previous = this.db.prepare('SELECT name FROM companies WHERE id=?').pluck().get(companyId) as string | undefined;
    if (previous === undefined) throw new Error('Company not found.');
    const renamed = previous.toLowerCase() !== v.name.toLowerCase();
    // A rename must not steal a name another company is already remembered by, or the importer
    // would have two candidates for the same string and could attach records to the wrong company.
    if (renamed) {
      const clash = this.db.prepare('SELECT company_id FROM company_aliases WHERE name=? COLLATE NOCASE').pluck().get(v.name) as number | undefined;
      if (clash !== undefined && clash !== companyId) throw new Error(`"${v.name}" is already a former name of ${this.db.prepare('SELECT name FROM companies WHERE id=?').pluck().get(clash)}. Pick a different name, or remove that former name first.`);
    }
    try {
      return this.db.transaction(() => {
        const result = this.db.prepare('UPDATE companies SET name=@name,business_summary=@business_summary,sector=@sector,website=@website,board_size=@board_size,other_board_members=@other_board_members,meeting_cadence=@meeting_cadence,notes=@notes,updated_at=CURRENT_TIMESTAMP WHERE id=@id').run({ ...v, id: companyId });
        this.ensureChange(result, 'Company');
        // Remember what it used to be called, so an import file written against the old name still
        // matches. Any alias equal to the new name is dropped: a company is not its own former name.
        if (renamed) {
          this.db.prepare("INSERT OR IGNORE INTO company_aliases(company_id,name,source) VALUES (?,?,'rename')").run(companyId, previous);
          this.db.prepare('DELETE FROM company_aliases WHERE company_id=? AND name=? COLLATE NOCASE').run(companyId, v.name);
        }
        return this.getCompany(companyId)!;
      })();
    } catch (error) { return this.duplicate(error, 'company'); }
  }

  listCompanyAliases(companyId: number): CompanyAlias[] { return this.db.prepare('SELECT * FROM company_aliases WHERE company_id=? ORDER BY created_at DESC, id DESC').all(positiveId(companyId, 'Company')) as CompanyAlias[]; }

  addCompanyAlias(companyId: number, name: string): CompanyAlias {
    const id = positiveId(companyId, 'Company');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('A former name is required.');
    if ((this.db.prepare('SELECT name FROM companies WHERE id=?').pluck().get(id) as string | undefined)?.toLowerCase() === trimmed.toLowerCase()) throw new Error('That is the company\u2019s current name.');
    const owner = this.db.prepare('SELECT id FROM companies WHERE name=? COLLATE NOCASE').pluck().get(trimmed) as number | undefined;
    if (owner !== undefined) throw new Error(`"${trimmed}" is the current name of another company.`);
    try { const result = this.db.prepare("INSERT INTO company_aliases(company_id,name,source) VALUES (?,?,'manual')").run(id, trimmed); return this.db.prepare('SELECT * FROM company_aliases WHERE id=?').get(result.lastInsertRowid) as CompanyAlias; }
    catch (error) { if (String(error).includes('UNIQUE')) throw new Error(`"${trimmed}" is already recorded as a former name.`); throw error; }
  }

  deleteCompanyAlias(aliasId: number): void { const result = this.db.prepare('DELETE FROM company_aliases WHERE id=?').run(positiveId(aliasId, 'Former name')); this.ensureChange(result, 'Former name'); }
  deleteCompany(id: number): void { const result = this.db.prepare('DELETE FROM companies WHERE id=?').run(positiveId(id, 'Company')); this.ensureChange(result, 'Company'); }

  createPosition(input: PositionInput): Position { const v = validatePosition(input); const result = this.db.prepare('INSERT INTO positions(company_id,status,position_type,start_date,end_date,expected_decision_date,notes) VALUES (@company_id,@status,@position_type,@start_date,@end_date,@expected_decision_date,@notes)').run(v); return this.one<Position>('SELECT * FROM positions WHERE id=?', result.lastInsertRowid); }
  updatePosition(id: number, input: PositionInput): Position { const v = validatePosition(input); const result = this.db.prepare('UPDATE positions SET company_id=@company_id,status=@status,position_type=@position_type,start_date=@start_date,end_date=@end_date,expected_decision_date=@expected_decision_date,notes=@notes,updated_at=CURRENT_TIMESTAMP WHERE id=@id').run({ ...v, id: positiveId(id, 'Position') }); this.ensureChange(result, 'Position'); return this.one<Position>('SELECT * FROM positions WHERE id=?', id); }
  deletePosition(id: number): void { const result = this.db.prepare('DELETE FROM positions WHERE id=?').run(positiveId(id, 'Position')); this.ensureChange(result, 'Position'); }

  createCompensation(input: CompensationInput): Compensation { const v = validateCompensation(input); const result = this.db.prepare('INSERT INTO compensation(position_id,type,amount,currency,frequency,instrument_type_id,quantity,grant_price,grant_date,notes) VALUES (@position_id,@type,@amount,@currency,@frequency,@instrument_type_id,@quantity,@grant_price,@grant_date,@notes)').run(v); return this.one<Compensation>('SELECT * FROM compensation WHERE id=?', result.lastInsertRowid); }
  updateCompensation(id: number, input: CompensationInput): Compensation { const v = validateCompensation(input); return this.db.transaction(() => { const result = this.db.prepare('UPDATE compensation SET position_id=@position_id,type=@type,amount=@amount,currency=@currency,frequency=@frequency,instrument_type_id=@instrument_type_id,quantity=@quantity,grant_price=@grant_price,grant_date=@grant_date,notes=@notes,updated_at=CURRENT_TIMESTAMP WHERE id=@id').run({ ...v, id: positiveId(id, 'Compensation') }); this.ensureChange(result, 'Compensation'); if (v.type === 'cash') this.db.prepare('DELETE FROM vesting_schedules WHERE compensation_id=?').run(id); return this.one<Compensation>('SELECT * FROM compensation WHERE id=?', id); })(); }
  deleteCompensation(id: number): void { const result = this.db.prepare('DELETE FROM compensation WHERE id=?').run(positiveId(id, 'Compensation')); this.ensureChange(result, 'Compensation'); }

  listInstrumentTypes(): InstrumentType[] { return this.db.prepare('SELECT * FROM instrument_types ORDER BY name COLLATE NOCASE').all() as InstrumentType[]; }
  createInstrumentType(input: InstrumentTypeInput): InstrumentType { const v = validateInstrumentType(input); try { const result = this.db.prepare('INSERT INTO instrument_types(name,description) VALUES (@name,@description)').run(v); return this.one<InstrumentType>('SELECT * FROM instrument_types WHERE id=?', result.lastInsertRowid); } catch (error) { return this.duplicate(error, 'instrument type'); } }
  updateInstrumentType(id: number, input: InstrumentTypeInput): InstrumentType { const v = validateInstrumentType(input); try { const result = this.db.prepare('UPDATE instrument_types SET name=@name,description=@description WHERE id=@id').run({ ...v, id: positiveId(id, 'Instrument type') }); this.ensureChange(result, 'Instrument type'); return this.one<InstrumentType>('SELECT * FROM instrument_types WHERE id=?', id); } catch (error) { return this.duplicate(error, 'instrument type'); } }
  deleteInstrumentType(id: number): void { const instrumentTypeId = positiveId(id, 'Instrument type'); const inUse = this.db.prepare('SELECT COUNT(*) FROM compensation WHERE instrument_type_id=?').pluck().get(instrumentTypeId) as number; if (inUse) throw new ValidationError('This instrument type is in use by non-cash compensation and cannot be deleted.'); const result = this.db.prepare('DELETE FROM instrument_types WHERE id=?').run(instrumentTypeId); this.ensureChange(result, 'Instrument type'); }

  createVestingSchedule(input: VestingScheduleInput): VestingSchedule { const v = validateVestingSchedule(input); const result = this.db.prepare('INSERT INTO vesting_schedules(compensation_id,schedule_type,cliff_date,vesting_start,vesting_end,cadence,notes) VALUES (@compensation_id,@schedule_type,@cliff_date,@vesting_start,@vesting_end,@cadence,@notes)').run(v); return this.one<VestingSchedule>('SELECT * FROM vesting_schedules WHERE id=?', result.lastInsertRowid); }
  updateVestingSchedule(id: number, input: VestingScheduleInput): VestingSchedule { const v = validateVestingSchedule(input); const result = this.db.prepare('UPDATE vesting_schedules SET compensation_id=@compensation_id,schedule_type=@schedule_type,cliff_date=@cliff_date,vesting_start=@vesting_start,vesting_end=@vesting_end,cadence=@cadence,notes=@notes,updated_at=CURRENT_TIMESTAMP WHERE id=@id').run({ ...v, id: positiveId(id, 'Vesting schedule') }); this.ensureChange(result, 'Vesting schedule'); return this.one<VestingSchedule>('SELECT * FROM vesting_schedules WHERE id=?', id); }
  deleteVestingSchedule(id: number): void { const result = this.db.prepare('DELETE FROM vesting_schedules WHERE id=?').run(positiveId(id, 'Vesting schedule')); this.ensureChange(result, 'Vesting schedule'); }

  createDocument(input: DocumentInput): Document { const v = validateDocument(input); const result = this.db.prepare('INSERT INTO documents(company_id,position_id,compensation_id,document_type,file_path,file_name,description,document_date,status) VALUES (@company_id,@position_id,@compensation_id,@document_type,@file_path,@file_name,@description,@document_date,@status)').run(v); return this.one<Document>('SELECT * FROM documents WHERE id=?', result.lastInsertRowid); }
  updateDocument(id: number, input: DocumentInput): Document { const v = validateDocument(input); const result = this.db.prepare('UPDATE documents SET company_id=@company_id,position_id=@position_id,compensation_id=@compensation_id,document_type=@document_type,file_path=@file_path,file_name=@file_name,description=@description,document_date=@document_date,status=@status,updated_at=CURRENT_TIMESTAMP WHERE id=@id').run({ ...v, id: positiveId(id, 'Document') }); this.ensureChange(result, 'Document'); return this.one<Document>('SELECT * FROM documents WHERE id=?', id); }
  deleteDocument(id: number): void { const result = this.db.prepare('DELETE FROM documents WHERE id=?').run(positiveId(id, 'Document')); this.ensureChange(result, 'Document'); }

  dashboard(today = new Date().toISOString().slice(0, 10)): DashboardData {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM positions GROUP BY status').all() as {status: 'current'|'former'|'potential'; count: number}[];
    const counts = { current: 0, former: 0, potential: 0 }; rows.forEach((row) => counts[row.status] = row.count);
    const vestingRows = this.db.prepare(`SELECT vesting_schedules.*, compensation.position_id, positions.company_id, companies.name AS company_name, compensation.quantity, instrument_types.name AS instrument_type_name FROM vesting_schedules JOIN compensation ON compensation.id=vesting_schedules.compensation_id JOIN positions ON positions.id=compensation.position_id JOIN companies ON companies.id=positions.company_id LEFT JOIN instrument_types ON instrument_types.id=compensation.instrument_type_id WHERE vesting_schedules.id=(SELECT newer.id FROM vesting_schedules newer WHERE newer.compensation_id=vesting_schedules.compensation_id ORDER BY newer.id DESC LIMIT 1) ORDER BY vesting_schedules.vesting_end IS NULL, vesting_schedules.vesting_end ASC, companies.name COLLATE NOCASE`).all() as Array<Omit<UpcomingVesting, 'vesting_summary'>>;
    const upcoming_vesting = vestingRows.map((schedule) => ({ ...schedule, vesting_summary: calculateVestingSummary(schedule, today) })).filter((schedule) => schedule.vesting_summary.kind === 'percentage' && (schedule.vesting_summary.percentage ?? 0) > 0 && (schedule.vesting_summary.percentage ?? 100) < 100) as UpcomingVesting[];
    const missing_documents = this.db.prepare('SELECT documents.*, companies.name AS company_name, positions.status AS position_status, positions.position_type, compensation.type AS compensation_type, compensation.quantity AS compensation_quantity, instrument_types.name AS instrument_type_name FROM documents JOIN companies ON companies.id=documents.company_id LEFT JOIN positions ON positions.id=documents.position_id LEFT JOIN compensation ON compensation.id=documents.compensation_id LEFT JOIN instrument_types ON instrument_types.id=compensation.instrument_type_id WHERE documents.status=\'missing\' ORDER BY companies.name COLLATE NOCASE, documents.document_type COLLATE NOCASE, documents.id').all() as DashboardData['missing_documents'];
    return { counts, upcoming: this.db.prepare("SELECT p.*, c.name AS company_name FROM positions p JOIN companies c ON c.id=p.company_id WHERE p.status='potential' ORDER BY p.expected_decision_date IS NULL, p.expected_decision_date ASC, c.name COLLATE NOCASE").all() as DashboardData['upcoming'], upcoming_vesting, missing_documents };
  }
  previewExtractedImport(contents: string, sourceLabel: string, selections: ImportSelections = {}): ImportPlan { return previewImport(this.db, parseImportFile(contents, sourceLabel), selections); }
  commitExtractedImport(contents: string, sourceLabel: string, selections: ImportSelections = {}): ImportPlan { return commitImport(this.db, parseImportFile(contents, sourceLabel), selections); }
  listImportBatches(): ImportBatch[] { return this.db.prepare('SELECT id,source_label,source_tool,source_reference,source_notes,schema_version,generated_at,summary_json,imported_at FROM import_batches ORDER BY imported_at DESC, id DESC LIMIT 100').all() as ImportBatch[]; }

  importSeedCompanies(seed: unknown): { inserted: number; skipped: number } { if (!Array.isArray(seed)) throw new ValidationError('Seed data must be an array.'); const insert = this.db.prepare('INSERT OR IGNORE INTO companies(name,business_summary,sector,website) VALUES (@name,@business_summary,@sector,@website)'); let inserted = 0; let skipped = 0; this.db.transaction(() => seed.forEach((item) => { const i = item as Record<string, unknown>; const data = validateCompany({ name: i.name as string, business_summary: i.business_summary as string | null, sector: i.sector as string | null, website: i.website as string | null }); const result = insert.run(data); if (result.changes) inserted++; else skipped++; }))(); return { inserted, skipped }; }
}
