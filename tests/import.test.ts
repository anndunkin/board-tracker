import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { companyInput, documentInput, importFile, nonCashInput, positionInput, testDatabase } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
import type { ImportOperation, ImportPlan } from '../src/shared/types';
import { EXTRACTION_PROMPT } from '../src/shared/extraction-prompt';
import { IMPORT_SCHEMA_ID, IMPORT_SCHEMA_VERSION } from '../src/main/import-schema';

let db: BoardTrackerDatabase; let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());

const preview = (payload: unknown, selections = {}): ImportPlan => db.previewExtractedImport(JSON.stringify(payload), 'extraction.json', selections);
const commit = (payload: unknown, selections = {}): ImportPlan => db.commitExtractedImport(JSON.stringify(payload), 'extraction.json', selections);
const op = (plan: ImportPlan, key: string): ImportOperation => plan.operations.find((entry) => entry.key === key) ?? (() => { throw new Error(`No operation for ${key}. Got: ${plan.operations.map((entry) => entry.key).join(', ')}`); })();
const rowCounts = () => ({ companies: db.db.prepare('SELECT COUNT(*) FROM companies').pluck().get(), positions: db.db.prepare('SELECT COUNT(*) FROM positions').pluck().get(), compensation: db.db.prepare('SELECT COUNT(*) FROM compensation').pluck().get(), vesting: db.db.prepare('SELECT COUNT(*) FROM vesting_schedules').pluck().get(), documents: db.db.prepare('SELECT COUNT(*) FROM documents').pluck().get() });

describe('import: end-to-end mapping of an extracted file', () => {
  it('creates a company, position, non-cash grant, vesting schedule, and linked document from one file', () => {
    const plan = commit(importFile());
    expect(plan.counts).toMatchObject({ conflict: 0, blocked: 0 });
    expect(plan.batch_id).toBeGreaterThan(0);
    const company = db.listCompanies('AutoBridge')[0];
    const detail = db.getCompany(company.id)!;
    expect(detail).toMatchObject({ name: 'AutoBridge Systems', sector: 'Automotive software', board_size: 6 });
    expect(detail.positions).toHaveLength(1);
    const position = detail.positions[0];
    expect(position).toMatchObject({ position_type: 'advisory_board', status: 'current', start_date: '2026-03-01' });
    expect(position.compensation).toHaveLength(1);
    expect(position.compensation[0]).toMatchObject({ type: 'non_cash', quantity: 25000, grant_price: 1.25, grant_date: '2026-03-01', instrument_type_name: 'Options' });
    expect(position.compensation[0].active_vesting_schedule).toMatchObject({ schedule_type: 'cliff_linear', cliff_date: '2027-03-01', vesting_start: '2026-03-01', vesting_end: '2030-03-01', cadence: 'monthly' });
    expect(detail.documents).toEqual([expect.objectContaining({ document_type: 'advisor_agreement', status: 'linked', file_name: 'autobridge-advisor-agreement.pdf' })]);
  });

  it('records the raw payload and the per-record extraction payload for the audit trail', () => {
    const file = importFile();
    const plan = commit(file);
    const batch = db.listImportBatches();
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ id: plan.batch_id, source_label: 'extraction.json', source_tool: 'Perplexity', schema_version: 1, generated_at: '2026-08-09' });
    expect(JSON.parse(db.db.prepare('SELECT payload_json FROM import_batches WHERE id=?').pluck().get(plan.batch_id) as string)).toEqual(file);
    expect(JSON.parse(JSON.parse(batch[0].summary_json!) ? batch[0].summary_json! : '{}')).toMatchObject({ create: expect.any(Number) });
    const compensation = db.db.prepare('SELECT extracted_data_json, import_batch_id FROM compensation WHERE quantity=25000').get() as { extracted_data_json: string; import_batch_id: number };
    expect(JSON.parse(compensation.extracted_data_json)).toEqual({ clause: '3(a)', confidence: 'high', quoted_text: '25,000 options at $1.25' });
    expect(compensation.import_batch_id).toBe(plan.batch_id);
    const document = db.db.prepare('SELECT extracted_data_json, import_batch_id FROM documents WHERE document_type=?').get('advisor_agreement') as { extracted_data_json: string; import_batch_id: number };
    expect(JSON.parse(document.extracted_data_json)).toEqual({ pages: 9, signed: true });
    expect(document.import_batch_id).toBe(plan.batch_id);
  });

  it('creates a cash retainer with its own currency and frequency', () => {
    commit(importFile({ companies: [{ name: 'Bowtie Security', positions: [{ status: 'current', position_type: 'governing_board', start_date: '2026-01-15', compensation: [{ type: 'cash', amount: 40000, currency: 'eur', frequency: 'annual', notes: 'Annual retainer' }] }] }] }));
    const company = db.listCompanies('Bowtie')[0];
    expect(db.getCompany(company.id)!.positions[0].compensation[0]).toMatchObject({ type: 'cash', amount: 40000, currency: 'EUR', frequency: 'annual', instrument_type_id: null });
  });

  it('creates a referenced instrument type that does not exist yet, and reuses seeded ones', () => {
    const plan = commit(importFile({ companies: [{ name: 'CrowdGenAI', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'non_cash', instrument_type: 'Phantom Units', quantity: 500 }, { type: 'non_cash', instrument_type: 'stock', quantity: 100 }] }] }] }));
    expect(op(plan, 'instrument_types[phantom units]').action).toBe('create');
    expect(op(plan, 'instrument_types[stock]').action).toBe('skip');
    expect(db.listInstrumentTypes().map((type) => type.name)).toContain('Phantom Units');
    expect(db.listInstrumentTypes().filter((type) => type.name.toLowerCase() === 'stock')).toHaveLength(1);
  });

  it('flags missing documents so they appear on the dashboard', () => {
    commit(importFile({ companies: [{ name: 'Open Origin', documents: [{ document_type: 'confirmation_of_shares', status: 'missing', description: 'Referenced in section 4 but not provided' }] }] }));
    expect(db.dashboard().missing_documents).toEqual([expect.objectContaining({ company_name: 'Open Origin', document_type: 'confirmation_of_shares', status: 'missing', file_path: null })]);
  });
});

describe('import: the extraction prompt', () => {
  it('is the same text the docs publish, so the button and the docs cannot drift apart', () => {
    const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'import-schema.md'), 'utf8');
    const quoted = docs.split('\n').filter((line) => line.startsWith('> ')).map((line) => line.slice(2).trim()).join(' ');
    expect(quoted).toBe(EXTRACTION_PROMPT);
  });

  it('names the schema and version the parser actually accepts', () => {
    expect(EXTRACTION_PROMPT).toContain(IMPORT_SCHEMA_ID);
    expect(EXTRACTION_PROMPT).toContain(`schema version ${IMPORT_SCHEMA_VERSION}`);
  });
});

describe('import: pasted JSON', () => {
  it('is imported the same way a picked file is, since only the source label differs', () => {
    const example = fs.readFileSync(path.join(__dirname, '..', 'docs', 'import-example.json'), 'utf8');
    const pasted = db.previewExtractedImport(example, 'Pasted JSON');
    expect(pasted.source.label).toBe('Pasted JSON');
    expect(pasted.operations).toEqual(db.previewExtractedImport(example, 'import-example.json').operations);
  });

  it('reports a readable error when the pasted text is not JSON at all', () => {
    expect(() => db.previewExtractedImport('I pasted the chat reply by mistake', 'Pasted JSON')).toThrow(/JSON/i);
  });

  it('tolerates the code fence people paste along with the JSON body', () => {
    const example = fs.readFileSync(path.join(__dirname, '..', 'docs', 'import-example.json'), 'utf8');
    expect(() => db.previewExtractedImport('```json\n' + example + '\n```', 'Pasted JSON')).not.toThrow();
  });
});

describe('import: the documented example file', () => {
  it('imports cleanly, so docs/import-example.json stays in sync with the parser', () => {
    const example = fs.readFileSync(path.join(__dirname, '..', 'docs', 'import-example.json'), 'utf8');
    const plan = db.commitExtractedImport(example, 'import-example.json');
    expect(plan.counts).toMatchObject({ conflict: 0, blocked: 0 });
    expect(plan.counts.create).toBeGreaterThan(10);
    const autobridge = db.getCompany(db.listCompanies('AutoBridge')[0].id)!;
    expect(autobridge.positions[0].compensation).toHaveLength(2);
    expect(autobridge.documents).toHaveLength(4);
    expect(db.dashboard().missing_documents.map((item) => item.document_type)).toEqual(['confirmation_of_shares']);
    const bowtie = db.getCompany(db.listCompanies('Bowtie')[0].id)!;
    expect(bowtie.positions[0]).toMatchObject({ status: 'potential', expected_decision_date: '2026-10-15' });
    expect(db.commitExtractedImport(example, 'import-example.json').counts).toMatchObject({ create: 0, update: 0, conflict: 0, blocked: 0 });
  });
});

describe('import: review before commit', () => {
  it('writes nothing to the database when previewing', () => {
    const before = rowCounts();
    const plan = preview(importFile());
    expect(plan.counts.create).toBeGreaterThan(0);
    expect(rowCounts()).toEqual(before);
    expect(db.listImportBatches()).toEqual([]);
  });

  it('produces the same operation keys and actions in preview as in commit', () => {
    const file = importFile();
    const planned = preview(file).operations.map(({ key, action }) => ({ key, action }));
    const committed = commit(file).operations.map(({ key, action }) => ({ key, action }));
    expect(committed).toEqual(planned);
  });

  it('matches an existing company by case-insensitive name instead of creating a duplicate', () => {
    db.createCompany({ ...companyInput('AUTOBRIDGE SYSTEMS'), sector: null, board_size: null });
    const plan = commit(importFile());
    expect(op(plan, 'companies[0]').action).toBe('skip');
    expect(db.db.prepare('SELECT COUNT(*) FROM companies').pluck().get()).toBe(1);
  });

  it('fills empty company profile fields but reports differing values as a conflict that is off by default', () => {
    const company = db.createCompany({ name: 'AutoBridge Systems', sector: 'Legacy sector', business_summary: null, website: null, board_size: null, other_board_members: null, meeting_cadence: null, notes: null });
    const plan = preview(importFile());
    const fields = op(plan, 'companies[0].fields');
    expect(fields.action).toBe('conflict');
    expect(fields.default_selected).toBe(false);
    expect(fields.selected).toBe(false);
    expect(fields.changes).toEqual(expect.arrayContaining([{ field: 'sector', from: 'Legacy sector', to: 'Automotive software', overwrite: true }, { field: 'board_size', from: null, to: '6', overwrite: false }]));
    commit(importFile());
    expect(db.getCompany(company.id)).toMatchObject({ sector: 'Legacy sector', board_size: null });
    commit(importFile(), { 'companies[0].fields': true });
    expect(db.getCompany(company.id)).toMatchObject({ sector: 'Automotive software', board_size: 6 });
  });

  it('is idempotent: re-importing the same file reports skips and changes no rows', () => {
    commit(importFile());
    const after = rowCounts();
    const second = commit(importFile());
    expect(second.counts).toMatchObject({ create: 0, conflict: 0, blocked: 0 });
    expect(second.operations.every((entry) => entry.action === 'skip')).toBe(true);
    expect(rowCounts()).toEqual(after);
    expect(db.listImportBatches()).toHaveLength(2);
  });

  it('attaches an extracted file to an existing missing-document flag as a safe update', () => {
    const company = db.createCompany(companyInput('AutoBridge Systems'));
    const flag = db.createDocument(documentInput(company.id, { document_type: 'advisor_agreement', file_path: null, file_name: null, description: null, document_date: null, status: 'missing' }));
    const plan = commit(importFile({ companies: [{ name: 'AutoBridge Systems', documents: [{ document_type: 'advisor_agreement', status: 'linked', file_path: 'C:\\Board\\autobridge-advisor-agreement.pdf', document_date: '2026-03-01' }] }] }));
    const operation = plan.operations.find((entry) => entry.kind === 'document')!;
    expect(operation).toMatchObject({ action: 'update', default_selected: true, reason: 'Attaches the extracted file to the existing missing-document flag.' });
    expect(db.db.prepare('SELECT id,status,file_name FROM documents WHERE id=?').get(flag.id)).toMatchObject({ id: flag.id, status: 'linked', file_name: 'autobridge-advisor-agreement.pdf' });
    expect(db.db.prepare('SELECT COUNT(*) FROM documents').pluck().get()).toBe(1);
  });

  it('treats clearing an existing file link as a conflict that must be opted into', () => {
    const company = db.createCompany(companyInput('AutoBridge Systems'));
    const linked = db.createDocument(documentInput(company.id, { document_type: 'advisor_agreement' }));
    const file = importFile({ companies: [{ name: 'AutoBridge Systems', documents: [{ document_type: 'advisor_agreement', status: 'missing' }] }] });
    const operation = preview(file).operations.find((entry) => entry.kind === 'document')!;
    expect(operation).toMatchObject({ action: 'conflict', default_selected: false });
    expect(operation.changes).toEqual(expect.arrayContaining([{ field: 'status', from: 'linked', to: 'missing', overwrite: true }]));
    commit(file);
    expect(db.db.prepare('SELECT status,file_path FROM documents WHERE id=?').get(linked.id)).toMatchObject({ status: 'linked', file_path: 'C:\\Board Documents\\agreement.pdf' });
    commit(file, { [operation.key]: true });
    expect(db.db.prepare('SELECT status,file_path,file_name FROM documents WHERE id=?').get(linked.id)).toMatchObject({ status: 'missing', file_path: null, file_name: null });
  });

  it('reports an existing grant whose price differs as a conflict rather than silently overwriting it', () => {
    const company = db.createCompany(companyInput('AutoBridge Systems'));
    const position = db.createPosition(positionInput(company.id, { position_type: 'advisory_board', status: 'current', start_date: '2026-03-01' }));
    const options = db.listInstrumentTypes().find((type) => type.name === 'Options')!;
    const existing = db.createCompensation(nonCashInput(position.id, options.id, { quantity: 25000, grant_price: 9.99, grant_date: '2026-03-01', notes: 'Manually entered' }));
    const plan = preview(importFile());
    const compensation = plan.operations.find((entry) => entry.kind === 'compensation')!;
    expect(compensation).toMatchObject({ action: 'conflict', default_selected: false });
    expect(compensation.changes).toEqual(expect.arrayContaining([{ field: 'grant_price', from: '9.99', to: '1.25', overwrite: true }]));
    commit(importFile());
    expect(db.db.prepare('SELECT grant_price FROM compensation WHERE id=?').pluck().get(existing.id)).toBe(9.99);
    commit(importFile(), { [compensation.key]: true });
    expect(db.db.prepare('SELECT grant_price FROM compensation WHERE id=?').pluck().get(existing.id)).toBe(1.25);
  });

  it('blocks the whole subtree when a parent create is deselected', () => {
    const plan = preview(importFile(), { 'companies[0]': false });
    expect(op(plan, 'companies[0]').selected).toBe(false);
    expect(op(plan, 'companies[0].positions[0]')).toMatchObject({ action: 'blocked', reason: 'Parent company was not imported.' });
    expect(op(plan, 'companies[0].documents[0]').action).toBe('blocked');
    expect(rowCounts()).toMatchObject({ companies: 0, positions: 0, compensation: 0, documents: 0 });
  });

  it('blocks a grant and its children when its new instrument type is deselected', () => {
    const file = importFile({ companies: [{ name: 'CrowdGenAI', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'non_cash', instrument_type: 'Phantom Units', quantity: 500, vesting: { schedule_type: 'immediate' } }] }] }] });
    const plan = commit(file, { 'instrument_types[phantom units]': false });
    const compensation = op(plan, 'companies[0].positions[0].compensation[0]');
    expect(compensation).toMatchObject({ action: 'blocked' });
    expect(compensation.reason).toContain('was not imported');
    expect(op(plan, 'companies[0].positions[0].compensation[0].vesting').action).toBe('blocked');
    expect(rowCounts()).toMatchObject({ compensation: 0, vesting: 0 });
  });

  it('imports only the selected branch when other branches are deselected', () => {
    const file = importFile({ companies: [{ name: 'One', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'cash', amount: 1000, frequency: 'annual' }] }] }, { name: 'Two', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'cash', amount: 2000, frequency: 'annual' }] }] }] });
    commit(file, { 'companies[1]': false });
    expect(db.listCompanies().map((company) => company.name)).toEqual(['One']);
  });

  it('writes nothing when every operation is deselected, but still records the reviewed file', () => {
    const plan = commit(importFile(), { 'companies[0]': false });
    expect(plan.selected_count).toBe(0);
    expect(rowCounts()).toMatchObject({ companies: 0, positions: 0, compensation: 0, vesting: 0, documents: 0 });
    expect(db.listImportBatches()).toHaveLength(1);
  });

  it('blocks an ambiguous position match instead of guessing', () => {
    const company = db.createCompany(companyInput('AutoBridge Systems'));
    db.createPosition(positionInput(company.id, { position_type: 'advisory_board', status: 'current', start_date: '2024-01-01' }));
    db.createPosition(positionInput(company.id, { position_type: 'advisory_board', status: 'current', start_date: '2025-01-01' }));
    const plan = preview(importFile({ companies: [{ name: 'AutoBridge Systems', positions: [{ status: 'current', position_type: 'advisory_board', notes: 'From the agreement' }] }] }));
    const position = op(plan, 'companies[0].positions[0]');
    expect(position.action).toBe('blocked');
    expect(position.reason).toContain('Add a start_date');
  });
});

describe('import: boundary and malformed input handling', () => {
  const rejects = (payload: unknown, pattern: RegExp) => expect(() => preview(payload)).toThrow(pattern);

  it('rejects a file that is not JSON, is empty, or is not an object', () => {
    expect(() => db.previewExtractedImport('   ', 'x.json')).toThrow(/empty/i);
    expect(() => db.previewExtractedImport('{not json', 'x.json')).toThrow(/not valid JSON/i);
    rejects([], /must be an object/);
  });

  it('rejects a file larger than 5 MB', () => {
    const payload = importFile({ companies: [{ name: 'Big', fields: { notes: 'x' } }] });
    const oversized = `${JSON.stringify(payload).slice(0, -1)},"padding":"${'x'.repeat(5 * 1024 * 1024)}"}`;
    expect(() => db.previewExtractedImport(oversized, 'big.json')).toThrow(/5 MB or smaller/);
  });

  it('rejects a wrong schema id or a future schema version', () => {
    rejects({ ...importFile(), schema: 'something-else' }, /schema must be "board-tracker.import"/);
    rejects({ ...importFile(), schema_version: 2 }, /supports up to version 1/);
    rejects({ ...importFile(), schema_version: 0 }, /between/);
  });

  it('rejects an empty or duplicated company list', () => {
    rejects({ ...importFile(), companies: [] }, /at least one company/);
    rejects(importFile({ companies: [{ name: 'Dup' }, { name: 'dup' }] }), /listed more than once/);
    rejects(importFile({ companies: [{ name: '   ' }] }), /companies\[0\]\.name: is required/);
  });

  it('rejects invalid enum values with the offending path', () => {
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'retired', position_type: 'advisor' }] }] }), /companies\[0\]\.positions\[0\]\.status: must be one of/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'chairman' }] }] }), /position_type: must be one of/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'cash', amount: 1, frequency: 'weekly' }] }] }] }), /frequency: must be one of/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'non_cash', instrument_type: 'Stock', quantity: 1, vesting: { schedule_type: 'gradual' } }] }] }] }), /vesting\.schedule_type: must be one of/);
  });

  it('rejects impossible and malformed dates', () => {
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', start_date: '2026-02-30' }] }] }), /must be a real calendar date/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', start_date: '03/01/2026' }] }] }), /YYYY-MM-DD/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', start_date: '2026-03-05', end_date: '2026-03-01' }] }] }), /cannot be before start_date/);
  });

  it('enforces the document status and file-path invariant in both directions', () => {
    rejects(importFile({ companies: [{ name: 'X', documents: [{ document_type: 'agreement', status: 'linked' }] }] }), /file_path: is required when status is "linked"/);
    rejects(importFile({ companies: [{ name: 'X', documents: [{ document_type: 'agreement', status: 'missing', file_path: 'C:\\x.pdf' }] }] }), /must be omitted when status is "missing"/);
  });

  it('requires the numeric fields each compensation type depends on', () => {
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'cash', frequency: 'annual' }] }] }] }), /amount: is required for cash/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'non_cash', instrument_type: 'Stock' }] }] }] }), /quantity: is required for non-cash/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'non_cash', instrument_type: 'Stock', quantity: '1000' }] }] }] }), /quantity: must be a number/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'non_cash', instrument_type: 'Stock', quantity: 2e12 }] }] }] }), /must be between/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'cash', amount: 100, currency: 'dollars', frequency: 'annual' }] }] }] }), /currency: must be 3 characters or fewer/);
    rejects(importFile({ companies: [{ name: 'X', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'cash', amount: 100, currency: 'U1D', frequency: 'annual' }] }] }] }), /three-letter ISO code/);
  });

  it('accepts a field at its maximum length and rejects one character more', () => {
    expect(preview(importFile({ companies: [{ name: 'A'.repeat(200) }] })).counts.create).toBe(1);
    rejects(importFile({ companies: [{ name: 'A'.repeat(201) }] }), /200 characters or fewer/);
    rejects(importFile({ companies: [{ name: 'X', fields: { notes: 'n'.repeat(10001) } }] }), /10000 characters or fewer/);
  });

  it('rejects lists and payloads beyond their caps', () => {
    rejects({ ...importFile(), companies: Array.from({ length: 501 }, (_, index) => ({ name: `Company ${index}` })) }, /500 entries or fewer/);
    rejects(importFile({ companies: [{ name: 'X', positions: Array.from({ length: 201 }, () => ({ status: 'current', position_type: 'advisor' })) }] }), /200 entries or fewer/);
    rejects(importFile({ companies: [{ name: 'X', documents: [{ document_type: 'agreement', status: 'missing', extracted_data: { blob: 'x'.repeat(200_001) } }] }] }), /200,000 characters or fewer/);
  });

  it('rejects wrongly typed containers with a readable path', () => {
    rejects(importFile({ companies: [{ name: 'X', positions: 'none' }] }), /positions: must be an array/);
    rejects(importFile({ companies: ['AutoBridge'] }), /companies\[0\]: must be an object/);
    rejects(importFile({ companies: [{ name: 'X', documents: [{ document_type: 'agreement', status: 'missing', extracted_data: 'raw text' }] }] }), /must be an object or array/);
  });

  it('ignores an ambiguous document match rather than picking one at random', () => {
    const company = db.createCompany(companyInput('AutoBridge Systems'));
    db.createDocument(documentInput(company.id, { document_type: 'advisor_agreement', file_path: 'C:\\a.pdf', file_name: 'a.pdf' }));
    db.createDocument(documentInput(company.id, { document_type: 'advisor_agreement', file_path: 'C:\\b.pdf', file_name: 'b.pdf' }));
    const plan = preview(importFile({ companies: [{ name: 'AutoBridge Systems', documents: [{ document_type: 'advisor_agreement', status: 'linked', file_path: 'C:\\c.pdf' }] }] }));
    const document = plan.operations.find((entry) => entry.kind === 'document')!;
    expect(document.action).toBe('blocked');
    expect(document.reason).toContain('Resolve them in the company view first');
  });
});

describe('import: security', () => {
  const injections = ["' OR 1=1 --", "x'); DROP TABLE companies; --", "Robert'); DROP TABLE documents;--", "%' UNION SELECT 1 --"];
  const xss = ['<script>window.pwned=true</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>'];

  it.each(injections)('stores SQL injection text in company, note, and document fields as literal data: %s', (payload) => {
    commit(importFile({ companies: [{ name: `Injected ${payload}`, fields: { notes: payload }, positions: [{ status: 'current', position_type: 'advisor', notes: payload, compensation: [{ type: 'cash', amount: 100, frequency: 'annual', notes: payload }] }], documents: [{ document_type: payload.slice(0, 100), status: 'missing', description: payload }] }] }));
    const company = db.listCompanies('Injected')[0];
    expect(db.getCompany(company.id)).toMatchObject({ name: `Injected ${payload}`, notes: payload });
    expect(db.getCompany(company.id)!.documents[0].description).toBe(payload);
    expect(db.db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('companies','documents','compensation','import_batches')").pluck().get()).toBe(4);
  });

  it.each(injections)('cannot inject SQL through a rogue company profile field name: %s', (payload) => {
    const company = db.createCompany({ ...companyInput('AutoBridge Systems'), sector: null });
    commit(importFile({ companies: [{ name: 'AutoBridge Systems', fields: { sector: 'Automotive software', [`${payload}`]: 'x', 'name=(SELECT name FROM companies)': 'x' } as Record<string, unknown> }] }));
    expect(db.getCompany(company.id)).toMatchObject({ name: 'AutoBridge Systems', sector: 'Automotive software' });
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").pluck().get()).toBe('companies');
  });

  it.each(xss)('stores XSS payloads verbatim and React escapes them on render: %s', (payload) => {
    commit(importFile({ companies: [{ name: `XSS ${payload}`, fields: { business_summary: payload }, documents: [{ document_type: 'agreement', status: 'missing', description: payload }] }] }));
    const company = db.listCompanies('XSS')[0];
    expect(db.getCompany(company.id)!.business_summary).toBe(payload);
    const html = renderToStaticMarkup(createElement('p', null, db.getCompany(company.id)!.documents[0].description));
    expect(html).not.toContain(payload);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).toMatch(/&lt;/);
  });

  it('strips control characters that would corrupt display or log output', () => {
    commit(importFile({ companies: [{ name: 'Control\u0000Chars\u001b[31m', fields: { notes: 'line\u0007bell' } }] }));
    const company = db.listCompanies('Control')[0];
    expect(company.name).toBe('ControlChars[31m');
    expect(db.getCompany(company.id)!.notes).toBe('linebell');
  });

  it('does not let a payload key pollute Object.prototype', () => {
    const malicious = JSON.stringify({ ...importFile({ companies: [{ name: 'Proto' }] }), __proto__: { polluted: 'yes' }, constructor: { prototype: { polluted: 'yes' } } });
    db.commitExtractedImport(malicious, 'evil.json');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('ignores caller-supplied row ids so an import cannot target arbitrary records', () => {
    const other = db.createCompany(companyInput('Untouched Corp'));
    commit(importFile({ companies: [{ id: other.id, name: 'Different Corp', fields: { sector: 'Overwritten?' } }] }));
    expect(db.getCompany(other.id)).toMatchObject({ name: 'Untouched Corp', sector: 'Technology' });
    expect(db.listCompanies('Different')).toHaveLength(1);
  });

  it('leaves the database unchanged when a commit fails partway through validation', () => {
    const before = rowCounts();
    expect(() => commit(importFile({ companies: [{ name: 'Valid Corp', positions: [{ status: 'current', position_type: 'advisor' }] }, { name: 'Broken Corp', positions: [{ status: 'nope', position_type: 'advisor' }] }] }))).toThrow(/must be one of/);
    expect(rowCounts()).toEqual(before);
    expect(db.listImportBatches()).toEqual([]);
  });

  it('records long file paths and traversal-looking strings as inert text without touching the filesystem', () => {
    const traversal = '..\\..\\..\\Windows\\System32\\config\\SAM';
    commit(importFile({ companies: [{ name: 'Traversal Corp', documents: [{ document_type: 'agreement', status: 'linked', file_path: traversal }] }] }));
    const company = db.listCompanies('Traversal')[0];
    expect(db.getCompany(company.id)!.documents[0]).toMatchObject({ file_path: traversal, file_name: 'SAM' });
  });
});
