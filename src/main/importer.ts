import type Database from 'better-sqlite3';
import type { ImportChange, ImportCompanyNode, ImportCompensationNode, ImportDocumentNode, ImportOperation, ImportOperationAction, ImportPayload, ImportPlan, ImportPositionNode, ImportSelections, ImportVestingNode } from '../shared/types';

const POSITION_TYPE_LABELS: Record<string, string> = { governing_board: 'Governing board', advisory_board: 'Advisory board', advisor: 'Advisor' };
const titleCase = (value: string): string => value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
const blank = (value: unknown): boolean => value == null || value === '';
const defaultSelected = (action: ImportOperationAction): boolean => action === 'create' || action === 'update';

class Rollback extends Error {}

/** Compares a payload record against the matched row and decides whether it is a no-op, a safe fill, or an overwrite. */
function classify(existing: Record<string, unknown>, incoming: Record<string, unknown>): { action: 'skip' | 'update' | 'conflict'; changes: ImportChange[]; reason: string } {
  const changes: ImportChange[] = []; let overwrites = 0;
  for (const [field, to] of Object.entries(incoming)) {
    if (blank(to)) continue;
    const from = existing[field] ?? null;
    if (String(from ?? '') === String(to)) continue;
    const overwrite = !blank(from);
    if (overwrite) overwrites++;
    changes.push({ field, from: blank(from) ? null : String(from), to: String(to), overwrite });
  }
  if (!changes.length) return { action: 'skip', changes, reason: 'Already matches the existing record.' };
  if (overwrites) return { action: 'conflict', changes, reason: `${overwrites} existing value${overwrites === 1 ? '' : 's'} would be overwritten. Review and opt in to apply.` };
  return { action: 'update', changes, reason: 'Fills in fields that are currently empty.' };
}

class ImportRun {
  private readonly operations: ImportOperation[] = [];
  constructor(private readonly db: Database.Database, private readonly payload: ImportPayload, private readonly selections: ImportSelections, private readonly batchId: number | null) {}

  private applied(key: string, action: ImportOperationAction): boolean {
    if (action === 'skip' || action === 'blocked') return false;
    return this.selections[key] ?? defaultSelected(action);
  }

  private record(op: Omit<ImportOperation, 'selected' | 'default_selected'>): boolean {
    const default_selected = defaultSelected(op.action);
    const selected = this.applied(op.key, op.action);
    this.operations.push({ ...op, default_selected, selected });
    return selected;
  }

  private blockSubtree(key: string, kind: ImportOperation['kind'], context: string, label: string, reason: string): void {
    this.record({ key, kind, action: 'blocked', context, label, changes: [], reason });
  }

  /** Resolves an instrument type by name, recording a create operation when it does not exist yet. */
  private instrumentType(name: string, context: string): number | null {
    const key = `instrument_types[${name.toLowerCase()}]`;
    const existing = this.db.prepare('SELECT id FROM instrument_types WHERE name=? COLLATE NOCASE').pluck().get(name) as number | undefined;
    if (existing) { if (!this.operations.some((op) => op.key === key)) this.record({ key, kind: 'instrument_type', action: 'skip', context, label: name, changes: [], reason: 'Instrument type already exists.' }); return existing; }
    if (this.operations.some((op) => op.key === key)) return null; // A create was already planned for this name and declined.
    if (!this.record({ key, kind: 'instrument_type', action: 'create', context, label: name, changes: [{ field: 'name', from: null, to: name, overwrite: false }], reason: 'New instrument type referenced by this file.' })) return null;
    return this.db.prepare('INSERT INTO instrument_types(name,description) VALUES (?,?)').run(name, null).lastInsertRowid as number;
  }

  private document(doc: ImportDocumentNode, companyId: number, positionId: number | null, compensationId: number | null, key: string, context: string): void {
    const label = `${titleCase(doc.document_type)}${doc.file_name ? ` — ${doc.file_name}` : ''} (${doc.status})`;
    const candidates = this.db.prepare('SELECT * FROM documents WHERE company_id=? AND document_type=? COLLATE NOCASE AND position_id IS ? AND compensation_id IS ?').all(companyId, doc.document_type, positionId, compensationId) as Array<Record<string, unknown>>;
    // Prefer the same linked file, then a "missing" placeholder waiting for this document, then any single match.
    const existing = candidates.find((row) => doc.file_path && row.file_path === doc.file_path) ?? candidates.find((row) => row.status === 'missing') ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (candidates.length > 1 && !existing) return this.blockSubtree(key, 'document', context, label, `${candidates.length} existing "${doc.document_type}" documents match this link. Resolve them in the company view first, then re-import.`);
    const incoming = { document_type: doc.document_type, status: doc.status, file_path: doc.file_path, file_name: doc.file_name, description: doc.description, document_date: doc.document_date, extracted_data_json: doc.extracted_data_json };
    if (!existing) {
      if (!this.record({ key, kind: 'document', action: 'create', context, label, changes: Object.entries(incoming).filter(([, to]) => !blank(to)).map(([field, to]) => ({ field, from: null, to: String(to), overwrite: false })), reason: doc.status === 'missing' ? 'New missing-document flag.' : 'New linked document.' })) return;
      this.db.prepare('INSERT INTO documents(company_id,position_id,compensation_id,document_type,file_path,file_name,description,document_date,status,extracted_data_json,import_batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(companyId, positionId, compensationId, doc.document_type, doc.file_path, doc.file_name, doc.description, doc.document_date, doc.status, doc.extracted_data_json, this.batchId);
      return;
    }
    // Status is compared separately: filling in a missing flag is the intended attach flow, while un-linking an existing file is an overwrite.
    const verdict = classify(existing, { file_path: doc.file_path, file_name: doc.file_name, description: doc.description, document_date: doc.document_date, extracted_data_json: doc.extracted_data_json });
    const statusChanged = existing.status !== doc.status;
    const unlinking = statusChanged && existing.status === 'linked' && doc.status === 'missing';
    const changes = statusChanged ? [{ field: 'status', from: String(existing.status), to: doc.status, overwrite: unlinking }, ...verdict.changes] : verdict.changes;
    const attaching = statusChanged && existing.status === 'missing' && doc.status === 'linked';
    const action = unlinking || verdict.action === 'conflict' ? 'conflict' : changes.length ? 'update' : 'skip';
    const reason = action === 'conflict' ? (unlinking ? 'This would clear the file link on an existing document. Review and opt in to apply.' : verdict.reason) : attaching ? 'Attaches the extracted file to the existing missing-document flag.' : changes.length ? verdict.reason : 'Already matches the existing document.';
    if (!this.record({ key, kind: 'document', action, context, label, changes, reason })) return;
    // A "missing" flag must carry no file path, so un-linking clears both path columns rather than coalescing them.
    const fileSql = doc.status === 'missing' ? 'file_path=NULL,file_name=NULL' : 'file_path=COALESCE(?,file_path),file_name=COALESCE(?,file_name)';
    const fileParams = doc.status === 'missing' ? [] : [doc.file_path, doc.file_name];
    this.db.prepare(`UPDATE documents SET status=?,${fileSql},description=COALESCE(?,description),document_date=COALESCE(?,document_date),extracted_data_json=COALESCE(?,extracted_data_json),import_batch_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(doc.status, ...fileParams, doc.description, doc.document_date, doc.extracted_data_json, this.batchId, existing.id as number);
  }

  private vesting(vesting: ImportVestingNode, compensationId: number, key: string, context: string): void {
    const label = `Vesting — ${titleCase(vesting.schedule_type)}`;
    const existing = this.db.prepare('SELECT * FROM vesting_schedules WHERE compensation_id=? ORDER BY id DESC LIMIT 1').get(compensationId) as Record<string, unknown> | undefined;
    const incoming = { schedule_type: vesting.schedule_type, cliff_date: vesting.cliff_date, vesting_start: vesting.vesting_start, vesting_end: vesting.vesting_end, cadence: vesting.cadence, notes: vesting.notes };
    if (!existing) {
      if (!this.record({ key, kind: 'vesting', action: 'create', context, label, changes: Object.entries(incoming).filter(([, to]) => !blank(to)).map(([field, to]) => ({ field, from: null, to: String(to), overwrite: false })), reason: 'New vesting schedule.' })) return;
      this.db.prepare('INSERT INTO vesting_schedules(compensation_id,schedule_type,cliff_date,vesting_start,vesting_end,cadence,notes,extracted_data_json) VALUES (?,?,?,?,?,?,?,?)').run(compensationId, vesting.schedule_type, vesting.cliff_date, vesting.vesting_start, vesting.vesting_end, vesting.cadence, vesting.notes, vesting.extracted_data_json);
      return;
    }
    const verdict = classify(existing, incoming);
    if (!this.record({ key, kind: 'vesting', action: verdict.action, context, label, changes: verdict.changes, reason: verdict.reason })) return;
    this.db.prepare('UPDATE vesting_schedules SET schedule_type=?,cliff_date=COALESCE(?,cliff_date),vesting_start=COALESCE(?,vesting_start),vesting_end=COALESCE(?,vesting_end),cadence=COALESCE(?,cadence),notes=COALESCE(?,notes),extracted_data_json=COALESCE(?,extracted_data_json),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(vesting.schedule_type, vesting.cliff_date, vesting.vesting_start, vesting.vesting_end, vesting.cadence, vesting.notes, vesting.extracted_data_json, existing.id as number);
  }

  private compensation(comp: ImportCompensationNode, companyId: number, positionId: number, key: string, context: string): void {
    const instrumentTypeId = comp.type === 'non_cash' ? this.instrumentType(comp.instrument_type as string, context) : null;
    const label = comp.type === 'cash' ? `Cash — ${comp.amount?.toLocaleString()} ${comp.currency} ${comp.frequency?.replaceAll('_', ' ')}` : `${comp.instrument_type} — ${comp.quantity?.toLocaleString()} units`;
    if (comp.type === 'non_cash' && instrumentTypeId == null) {
      this.blockSubtree(key, 'compensation', context, label, `Instrument type "${comp.instrument_type}" was not imported, so this grant cannot be created.`);
      if (comp.vesting) this.blockSubtree(`${key}.vesting`, 'vesting', context, `Vesting — ${comp.vesting.schedule_type}`, 'Parent compensation was not imported.');
      comp.documents.forEach((doc, index) => this.blockSubtree(`${key}.documents[${index}]`, 'document', context, doc.document_type, 'Parent compensation was not imported.'));
      return;
    }
    const existing = comp.type === 'cash'
      ? this.db.prepare("SELECT * FROM compensation WHERE position_id=? AND type='cash' AND amount=? AND currency=? AND frequency=?").get(positionId, comp.amount, comp.currency, comp.frequency) as Record<string, unknown> | undefined
      : this.db.prepare("SELECT * FROM compensation WHERE position_id=? AND type='non_cash' AND instrument_type_id=? AND quantity=? AND grant_date IS ?").get(positionId, instrumentTypeId, comp.quantity, comp.grant_date) as Record<string, unknown> | undefined;
    let compensationId: number | null = null;
    if (!existing) {
      const changes: ImportChange[] = Object.entries({ type: comp.type, amount: comp.amount, currency: comp.currency, frequency: comp.frequency, instrument_type: comp.instrument_type, quantity: comp.quantity, grant_price: comp.grant_price, grant_date: comp.grant_date, notes: comp.notes }).filter(([, to]) => !blank(to)).map(([field, to]) => ({ field, from: null, to: String(to), overwrite: false }));
      if (this.record({ key, kind: 'compensation', action: 'create', context, label, changes, reason: 'New compensation record.' })) compensationId = this.db.prepare('INSERT INTO compensation(position_id,type,amount,currency,frequency,instrument_type_id,quantity,grant_price,grant_date,notes,extracted_data_json,import_batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(positionId, comp.type, comp.amount, comp.currency, comp.frequency, instrumentTypeId, comp.quantity, comp.grant_price, comp.grant_date, comp.notes, comp.extracted_data_json, this.batchId).lastInsertRowid as number;
    } else {
      compensationId = existing.id as number;
      const verdict = classify(existing, { grant_price: comp.grant_price, notes: comp.notes, extracted_data_json: comp.extracted_data_json });
      const reason = verdict.action === 'skip' ? 'An identical compensation record already exists.' : verdict.reason;
      if (this.record({ key, kind: 'compensation', action: verdict.action, context, label, changes: verdict.changes, reason }) && verdict.changes.length) this.db.prepare('UPDATE compensation SET grant_price=COALESCE(?,grant_price),notes=COALESCE(?,notes),extracted_data_json=COALESCE(?,extracted_data_json),import_batch_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(comp.grant_price, comp.notes, comp.extracted_data_json, this.batchId, compensationId);
    }
    if (compensationId == null) {
      if (comp.vesting) this.blockSubtree(`${key}.vesting`, 'vesting', context, `Vesting — ${comp.vesting.schedule_type}`, 'Parent compensation was not imported.');
      comp.documents.forEach((doc, index) => this.blockSubtree(`${key}.documents[${index}]`, 'document', context, doc.document_type, 'Parent compensation was not imported.'));
      return;
    }
    if (comp.vesting) this.vesting(comp.vesting, compensationId, `${key}.vesting`, `${context} › ${label}`);
    comp.documents.forEach((doc, index) => this.document(doc, companyId, positionId, compensationId as number, `${key}.documents[${index}]`, `${context} › ${label}`));
  }

  private position(position: ImportPositionNode, companyId: number, key: string, context: string): void {
    const label = `${POSITION_TYPE_LABELS[position.position_type]} (${position.status})${position.start_date ? ` from ${position.start_date}` : ''}`;
    const candidates = this.db.prepare('SELECT * FROM positions WHERE company_id=? AND position_type=? AND status=?').all(companyId, position.position_type, position.status) as Array<Record<string, unknown>>;
    const existing = (position.start_date ? candidates.find((row) => row.start_date === position.start_date) : undefined) ?? (candidates.length === 1 ? candidates[0] : undefined);
    let positionId: number | null = null;
    if (candidates.length > 1 && !existing) {
      this.blockSubtree(key, 'position', context, label, `${candidates.length} existing positions match this type and status. Add a start_date to the file so the right one can be identified.`);
    } else if (!existing) {
      const changes: ImportChange[] = Object.entries({ position_type: position.position_type, status: position.status, start_date: position.start_date, end_date: position.end_date, expected_decision_date: position.expected_decision_date, notes: position.notes }).filter(([, to]) => !blank(to)).map(([field, to]) => ({ field, from: null, to: String(to), overwrite: false }));
      if (this.record({ key, kind: 'position', action: 'create', context, label, changes, reason: 'New position for this company.' })) positionId = this.db.prepare('INSERT INTO positions(company_id,status,position_type,start_date,end_date,expected_decision_date,notes,extracted_data_json) VALUES (?,?,?,?,?,?,?,?)').run(companyId, position.status, position.position_type, position.start_date, position.end_date, position.expected_decision_date, position.notes, position.extracted_data_json).lastInsertRowid as number;
    } else {
      positionId = existing.id as number;
      const verdict = classify(existing, { start_date: position.start_date, end_date: position.end_date, expected_decision_date: position.expected_decision_date, notes: position.notes });
      const reason = verdict.action === 'skip' ? 'Matched an existing position; no field changes needed.' : verdict.reason;
      if (this.record({ key, kind: 'position', action: verdict.action, context, label, changes: verdict.changes, reason }) && verdict.changes.length) this.db.prepare('UPDATE positions SET start_date=COALESCE(?,start_date),end_date=COALESCE(?,end_date),expected_decision_date=COALESCE(?,expected_decision_date),notes=COALESCE(?,notes),extracted_data_json=COALESCE(?,extracted_data_json),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(position.start_date, position.end_date, position.expected_decision_date, position.notes, position.extracted_data_json, positionId);
    }
    if (positionId == null) {
      position.compensation.forEach((comp, index) => this.blockSubtree(`${key}.compensation[${index}]`, 'compensation', context, comp.instrument_type ?? 'Cash', 'Parent position was not imported.'));
      position.documents.forEach((doc, index) => this.blockSubtree(`${key}.documents[${index}]`, 'document', context, doc.document_type, 'Parent position was not imported.'));
      return;
    }
    const childContext = `${context} › ${label}`;
    position.compensation.forEach((comp, index) => this.compensation(comp, companyId, positionId as number, `${key}.compensation[${index}]`, childContext));
    position.documents.forEach((doc, index) => this.document(doc, companyId, positionId as number, null, `${key}.documents[${index}]`, childContext));
  }

  private company(company: ImportCompanyNode, key: string): void {
    // Match on the current name first, then on any name the company was previously known by, so a
    // rename does not turn the next import of the same agreement into a duplicate company.
    const existing = (this.db.prepare('SELECT * FROM companies WHERE name=? COLLATE NOCASE').get(company.name)
      ?? this.db.prepare('SELECT companies.* FROM companies JOIN company_aliases ON company_aliases.company_id=companies.id WHERE company_aliases.name=? COLLATE NOCASE').get(company.name)) as Record<string, unknown> | undefined;
    const matchedByFormerName = existing !== undefined && String(existing.name).toLowerCase() !== company.name.toLowerCase();
    let companyId: number | null = null;
    if (!existing) {
      const changes: ImportChange[] = [{ field: 'name', from: null, to: company.name, overwrite: false }, ...Object.entries(company.fields).filter(([, to]) => !blank(to)).map(([field, to]) => ({ field, from: null, to: String(to), overwrite: false }))];
      if (this.record({ key, kind: 'company', action: 'create', context: company.name, label: company.name, changes, reason: 'No company with this name exists yet.' })) companyId = this.db.prepare('INSERT INTO companies(name,business_summary,sector,website,board_size,other_board_members,meeting_cadence,notes,extracted_data_json) VALUES (?,?,?,?,?,?,?,?,?)').run(company.name, company.fields.business_summary, company.fields.sector, company.fields.website, company.fields.board_size, company.fields.other_board_members, company.fields.meeting_cadence, company.fields.notes, company.extracted_data_json).lastInsertRowid as number;
    } else {
      companyId = existing.id as number;
      this.record({ key, kind: 'company', action: 'skip', context: company.name, label: company.name, changes: [], reason: matchedByFormerName ? `Matched existing company #${companyId}, now named "${existing.name}", by its former name "${company.name}".` : `Matched existing company #${companyId}.` });
      const verdict = classify(existing, company.fields as Record<string, unknown>);
      if (verdict.changes.length && this.record({ key: `${key}.fields`, kind: 'company_fields', action: verdict.action, context: company.name, label: `${company.name} — profile fields`, changes: verdict.changes, reason: verdict.reason })) {
        const set = verdict.changes.map((change) => `${change.field}=@${change.field}`).join(',');
        // The audit payload rides along with a profile update but never triggers one on its own: it is
        // extraction metadata, not a value the user typed, so it must not raise a conflict.
        this.db.prepare(`UPDATE companies SET ${set},extracted_data_json=COALESCE(@extracted_data_json,extracted_data_json),updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...Object.fromEntries(verdict.changes.map((change) => [change.field, (company.fields as Record<string, unknown>)[change.field]])), extracted_data_json: company.extracted_data_json, id: companyId });
      }
    }
    if (companyId == null) {
      company.positions.forEach((position, index) => this.blockSubtree(`${key}.positions[${index}]`, 'position', company.name, position.position_type, 'Parent company was not imported.'));
      company.documents.forEach((doc, index) => this.blockSubtree(`${key}.documents[${index}]`, 'document', company.name, doc.document_type, 'Parent company was not imported.'));
      return;
    }
    company.positions.forEach((position, index) => this.position(position, companyId as number, `${key}.positions[${index}]`, company.name));
    company.documents.forEach((doc, index) => this.document(doc, companyId as number, null, null, `${key}.documents[${index}]`, company.name));
  }

  run(): ImportOperation[] {
    this.payload.companies.forEach((company, index) => this.company(company, `companies[${index}]`));
    return this.operations;
  }
}

const summarize = (operations: ImportOperation[], payload: ImportPayload): ImportPlan => ({
  schema_version: payload.schema_version,
  source: payload.source,
  generated_at: payload.generated_at,
  operations,
  counts: { create: 0, update: 0, conflict: 0, skip: 0, blocked: 0, ...operations.reduce<Record<string, number>>((totals, op) => ({ ...totals, [op.action]: (totals[op.action] ?? 0) + 1 }), {}) } as ImportPlan['counts'],
  selected_count: operations.filter((op) => op.selected).length,
  warnings: payload.warnings,
});

function walk(db: Database.Database, payload: ImportPayload, selections: ImportSelections, batchId: number | null): ImportOperation[] {
  return new ImportRun(db, payload, selections, batchId).run();
}

/** Runs the import against a savepoint and rolls it back, so the plan reflects exactly what a commit would do. */
export function previewImport(db: Database.Database, payload: ImportPayload, selections: ImportSelections = {}): ImportPlan {
  let operations: ImportOperation[] = [];
  try {
    db.transaction(() => { operations = walk(db, payload, selections, null); throw new Rollback(); })();
  } catch (error) { if (!(error instanceof Rollback)) throw error; }
  return summarize(operations, payload);
}

export function commitImport(db: Database.Database, payload: ImportPayload, selections: ImportSelections = {}): ImportPlan {
  // Committing a file whose records are all already present is a valid no-op; the batch row still records that the file was reviewed.
  return db.transaction((): ImportPlan => {
    const batchId = db.prepare('INSERT INTO import_batches(source_label,source_tool,source_reference,source_notes,schema_version,generated_at,payload_json,summary_json) VALUES (?,?,?,?,?,?,?,?)').run(payload.source.label, payload.source.tool, payload.source.reference, payload.source.notes, payload.schema_version, payload.generated_at, payload.payload_json, null).lastInsertRowid as number;
    const committed = summarize(walk(db, payload, selections, batchId), payload);
    db.prepare('UPDATE import_batches SET summary_json=? WHERE id=?').run(JSON.stringify(committed.counts), batchId);
    return { ...committed, batch_id: batchId };
  })();
}
