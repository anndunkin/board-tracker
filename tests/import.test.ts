import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { companyInput, documentInput, importFile, nonCashInput, positionInput, testDatabase } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
import type { ImportOperation, ImportPlan } from '../src/shared/types';
import { EXTRACTION_PROMPT } from '../src/shared/extraction-prompt';
import { companyResearchPrompt } from '../src/shared/research-prompt';
import { IMPORT_SCHEMA_ID, IMPORT_SCHEMA_VERSION } from '../src/main/import-schema';
import { importJsonSchemaText } from '../src/shared/import-json-schema';
import { cadences, compensationTypes, documentStatuses, frequencies, positionStatuses, positionTypes, scheduleTypes } from '../src/shared/import-constants';

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

/** The blockquote under one docs heading, unwrapped and reflowed onto a single line, so a prompt
 * published in the docs can be compared character-for-character with the one the app ships. */
const quotedUnder = (heading: string): string => {
  const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'import-schema.md'), 'utf8');
  const section = docs.slice(docs.indexOf(heading) + heading.length).split('\n## ')[0];
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('>')) { if (current.length) { paragraphs.push(current.join('\n')); current = []; } continue; }
    const text = line.slice(1).trim();
    if (!text) { if (current.length) { paragraphs.push(current.join('\n')); current = []; } continue; }
    // A new bullet starts its own line; a continuation is folded into the bullet above it.
    if (text.startsWith('- ') || !current.length) current.push(text);
    else current[current.length - 1] = `${current[current.length - 1]} ${text}`;
  }
  if (current.length) paragraphs.push(current.join('\n'));
  return paragraphs.join('\n\n');
};

describe('import: the extraction prompt', () => {
  it('is the same text the docs publish, so the button and the docs cannot drift apart', () => {
    expect(quotedUnder('## Prompt to use in a Perplexity session')).toBe(EXTRACTION_PROMPT);
  });

  it('publishes the research prompt too, with the company name and website left as placeholders', () => {
    // The docs show the prompt with {name}/{website} standing in for the record's own values, so
    // rendering the real function with those placeholders must reproduce the published text exactly.
    expect(quotedUnder('## Prompt behind "Research this company"')).toBe(companyResearchPrompt('{name}', '{website}'));
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

describe('import: every problem is reported at once', () => {
  const parse = (payload: unknown) => { try { db.previewExtractedImport(JSON.stringify(payload), 'x.json'); return ''; } catch (error) { return (error as Error).message; } };

  it('lists all validation failures in one pass instead of stopping at the first', () => {
    const message = parse({ schema: IMPORT_SCHEMA_ID, schema_version: 1, companies: [
      { name: 'Alpha', positions: [{ status: 'nope', position_type: 'advisor', compensation: [{ type: 'non_cash', quantity: 5 }] }] },
      { positions: [{ status: 'current', position_type: 'bad', start_date: 'not-a-date' }] },
    ] });
    expect(message).toMatch(/^Found 5 problems in this file:/);
    for (const fragment of ['positions[0].status', 'compensation[0].instrument_type', 'companies[1].name', 'positions[0].position_type', 'positions[0].start_date']) expect(message).toContain(fragment);
  });

  it('renders one problem in the singular and caps a very long list', () => {
    expect(parse({ schema: IMPORT_SCHEMA_ID, schema_version: 1, companies: [{ name: 'Alpha', positions: [{ status: 'current' }] }] })).toMatch(/^Found 1 problem in this file:/);
    const many = parse({ schema: IMPORT_SCHEMA_ID, schema_version: 1, companies: Array.from({ length: 40 }, () => ({ positions: [] })) });
    expect(many.split('\n')).toHaveLength(27);
    expect(many).toContain('…and 15 more.');
  });

  it('reports the offending value so the fix is obvious', () => {
    expect(parse({ schema: IMPORT_SCHEMA_ID, schema_version: 1, companies: [{ name: 'Alpha', positions: [{ status: 'active', position_type: 'advisor' }] }] })).toContain('Found "active".');
  });
});

describe('import: safe aliases', () => {
  const aliased = {
    schema: IMPORT_SCHEMA_ID, schema_version: 1,
    companies: [{ company_name: 'Alpha Corp', sector: 'Security', positions: [{ position_status: 'current', position_type: 'advisory_board', start_date: '2026-01-01', compensation: [{ compensation_type: 'non_cash', instrument: 'Non-Statutory Stock Option', shares: 1000, exercise_price: 0.07, vesting: [{ vesting_type: 'cliff_linear', commencement_date: '2026-01-01', post_cliff_period: 'monthly' }] }] }] }],
  };

  it('accepts pure renames, a single-item vesting array, and company fields hoisted out of "fields"', () => {
    const plan = commit(aliased);
    expect(plan.counts).toMatchObject({ conflict: 0, blocked: 0 });
    const detail = db.getCompany(db.listCompanies('Alpha Corp')[0].id)!;
    expect(detail.sector).toBe('Security');
    const grant = detail.positions[0].compensation[0];
    expect(grant).toMatchObject({ type: 'non_cash', quantity: 1000, grant_price: 0.07, instrument_type_name: 'Non-Statutory Stock Option' });
    expect(grant.active_vesting_schedule).toMatchObject({ schedule_type: 'cliff_linear', vesting_start: '2026-01-01', cadence: 'monthly' });
  });

  it('reports every rename rather than applying it silently', () => {
    const messages = preview(aliased).warnings.filter((warning) => warning.kind === 'alias').map((warning) => warning.message);
    for (const fragment of ['Read "company_name" as "name".', 'Read "sector" as "fields.sector".', 'Read "position_status" as "status".', 'Read "compensation_type" as "type".', 'Read "instrument" as "instrument_type".', 'Read "shares" as "quantity".', 'Read "exercise_price" as "grant_price".', 'Read the single-item vesting array as one vesting object.', 'Read "vesting_type" as "schedule_type".', 'Read "commencement_date" as "vesting_start".', 'Read "post_cliff_period" as "cadence".']) expect(messages).toContain(fragment);
  });

  it('never guesses a value, only a field name', () => {
    expect(() => preview({ ...aliased, companies: [{ ...aliased.companies[0], positions: [{ ...aliased.companies[0].positions[0], compensation: [{ ...aliased.companies[0].positions[0].compensation[0], vesting: [{ vesting_type: 'cliff_then_monthly' }] }] }] }] })).toThrow(/schedule_type: must be one of.*Found "cliff_then_monthly"/s);
  });

  it('keeps the canonical field when both it and an alias are present, and reports the alias as untracked', () => {
    const plan = preview({ schema: IMPORT_SCHEMA_ID, schema_version: 1, companies: [{ name: 'Real Name', company_name: 'Alias Name' }] });
    expect(op(plan, 'companies[0]').label).toBe('Real Name');
    expect(plan.warnings.find((warning) => warning.kind === 'unmapped')!.message).toContain('company_name: Alias Name');
  });
});

describe('import: unknown fields are kept, never silently dropped', () => {
  const withExtras = { schema: IMPORT_SCHEMA_ID, schema_version: 1, companies: [{
    name: 'Kapalya Inc.', dba: 'ArmorxAI', governing_law: 'Delaware',
    positions: [{ status: 'current', position_type: 'advisory_board', start_date: '2026-03-09', title: 'Advisory Board Member', time_commitment: '2 hours per month',
      compensation: [{ type: 'non_cash', instrument_type: 'NSO', quantity: 65010, security_class: 'Common Stock', reference_valuation_per_share: 0.07,
        vesting: { schedule_type: 'cliff_linear', vesting_start: '2026-03-09', cliff_fraction: '1/4', total_vesting_months: 48 } }] }] }] };

  it('preserves them in the audit payload for every record kind', () => {
    commit(withExtras);
    const detail = db.getCompany(db.listCompanies('Kapalya')[0].id)!;
    const payload = (id: number, table: string) => JSON.parse(db.db.prepare(`SELECT extracted_data_json FROM ${table} WHERE id=?`).pluck().get(id) as string).unmapped_fields;
    expect(payload(detail.id, 'companies')).toEqual({ dba: 'ArmorxAI', governing_law: 'Delaware' });
    expect(payload(detail.positions[0].id, 'positions')).toEqual({ title: 'Advisory Board Member', time_commitment: '2 hours per month' });
    expect(payload(detail.positions[0].compensation[0].id, 'compensation')).toEqual({ security_class: 'Common Stock', reference_valuation_per_share: 0.07 });
    expect(payload(detail.positions[0].compensation[0].active_vesting_schedule!.id, 'vesting_schedules')).toEqual({ cliff_fraction: '1/4', total_vesting_months: 48 });
  });

  it('names them and shows their values in the review plan before anything is committed', () => {
    const messages = preview(withExtras).warnings.filter((warning) => warning.kind === 'unmapped').map((warning) => warning.message);
    expect(messages).toContain('2 fields kept but not tracked — dba: ArmorxAI; governing_law: Delaware');
    expect(messages.join(' ')).toContain('security_class: Common Stock');
    expect(preview(withExtras).warnings.map((warning) => warning.path)).toContain('file.companies[0].positions[0].compensation[0].vesting');
  });

  it('leaves user-written notes alone, so an extraction cannot overwrite them or force a conflict', () => {
    const company = db.createCompany({ ...companyInput('Kapalya Inc.'), notes: 'My own note' });
    const plan = commit(withExtras);
    expect(plan.counts.conflict).toBe(0);
    expect(db.getCompany(company.id)!.notes).toBe('My own note');
  });

  it('keeps a supplied extracted_data payload alongside the untracked fields', () => {
    commit({ schema: IMPORT_SCHEMA_ID, schema_version: 1, companies: [{ name: 'Alpha', positions: [{ status: 'current', position_type: 'advisor', compensation: [{ type: 'cash', amount: 100, frequency: 'annual', extracted_data: { clause: '3.1' }, rogue: 'value' }] }] }] });
    const detail = db.getCompany(db.listCompanies('Alpha')[0].id)!;
    expect(JSON.parse(db.db.prepare('SELECT extracted_data_json FROM compensation WHERE id=?').pluck().get(detail.positions[0].compensation[0].id) as string)).toEqual({ clause: '3.1', unmapped_fields: { rogue: 'value' } });
  });

  it('says nothing when the file uses only schema fields', () => {
    expect(preview(importFile()).warnings).toEqual([]);
  });
});

describe('import: the published JSON Schema', () => {
  const schemaFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'board-tracker.import.schema.json'), 'utf8'));

  it('is checked in exactly as the app generates it, so the saved file matches the parser', () => {
    expect(`${JSON.stringify(schemaFile, null, 2)}\n`).toBe(importJsonSchemaText());
  });

  it('publishes the same enumerated values the parser enforces', () => {
    const company = schemaFile.properties.companies.items;
    const position = company.properties.positions.items;
    const compensation = position.properties.compensation.items;
    expect(position.properties.status.enum).toEqual(positionStatuses);
    expect(position.properties.position_type.enum).toEqual(positionTypes);
    expect(compensation.properties.type.enum).toEqual(compensationTypes);
    expect(compensation.properties.frequency.enum).toEqual([...frequencies, null]);
    expect(compensation.properties.vesting.properties.schedule_type.enum).toEqual(scheduleTypes);
    expect(compensation.properties.vesting.properties.cadence.enum).toEqual([...cadences, null]);
    expect(compensation.properties.documents.items.properties.status.enum).toEqual(documentStatuses);
    expect(schemaFile.properties.schema.const).toBe(IMPORT_SCHEMA_ID);
    expect(schemaFile.properties.schema_version.const).toBe(IMPORT_SCHEMA_VERSION);
  });

  it('describes vesting as one object, which is the mistake it exists to prevent', () => {
    const vesting = schemaFile.properties.companies.items.properties.positions.items.properties.compensation.items.properties.vesting;
    expect(vesting.type).toBe('object');
    expect(vesting.description).toContain('not an array');
    expect(vesting.properties.vesting_start.description).toContain('vesting commencement date');
  });
});

describe('import: the ArmorxAI extraction that v0.4.1 could not read', () => {
  const original = fs.readFileSync(path.join(__dirname, 'fixtures', 'armorxai-original.json'), 'utf8');

  it('now fails once, on the only thing a human has to decide, instead of four times on field names', () => {
    let message = '';
    try { db.previewExtractedImport(original, 'armorxai.json'); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/^Found 1 problem in this file:/);
    expect(message).toContain('vesting.schedule_type');
    expect(message).toContain('Found "cliff_then_monthly"');
  });

  it('reads the whole grant once that one value is corrected, losing nothing', () => {
    const corrected = original.replace('"cliff_then_monthly"', '"cliff_linear"');
    const plan = db.commitExtractedImport(corrected, 'armorxai.json');
    expect(plan.counts).toMatchObject({ conflict: 0, blocked: 0 });
    const detail = db.getCompany(db.listCompanies('Kapalya')[0].id)!;
    const grant = detail.positions[0].compensation[0];
    // v0.4.1 dropped every one of these, most damagingly vesting_start, which the dashboard's
    // percent-vested figure is computed from.
    expect(grant).toMatchObject({ type: 'non_cash', quantity: 65010, instrument_type_name: 'non-statutory stock option' });
    expect(grant.active_vesting_schedule).toMatchObject({ schedule_type: 'cliff_linear', vesting_start: '2026-03-09', cliff_date: '2027-03-09', cadence: 'monthly' });
    // The file states total_vesting_months: 48 but no vesting_end, and the schema has no field for a
    // duration, so the percentage stays uncalculable rather than being back-derived. The 48 is kept.
    expect(grant.vesting_summary).toMatchObject({ kind: 'not_calculable' });
    expect(JSON.parse(db.db.prepare('SELECT extracted_data_json FROM vesting_schedules WHERE compensation_id=?').pluck().get(grant.id) as string).unmapped_fields).toMatchObject({ total_vesting_months: 48, cliff_fraction: '1/4' });
    const kept = plan.warnings.filter((warning) => warning.kind === 'unmapped');
    expect(kept.length).toBeGreaterThan(3);
    expect(db.db.prepare('SELECT COUNT(*) FROM documents').pluck().get()).toBe(5);
  });

  it('refuses to infer the exercise price, and surfaces the number it declined to use', () => {
    const plan = db.commitExtractedImport(original.replace('"cliff_then_monthly"', '"cliff_linear"'), 'armorxai.json');
    const grant = db.getCompany(db.listCompanies('Kapalya')[0].id)!.positions[0].compensation[0];
    // The file gives "reference_valuation_per_share": 0.07 under a "latest 409A valuation" basis and
    // says only that the exercise price is fair market value at grant. Those are not the same claim,
    // so grant_price stays empty for a human to fill in — but the number is kept and shown, not lost.
    expect(grant.grant_price).toBeNull();
    const kept = JSON.parse(db.db.prepare('SELECT extracted_data_json FROM compensation WHERE id=?').pluck().get(grant.id) as string).unmapped_fields;
    expect(kept).toMatchObject({ reference_valuation_per_share: 0.07, reference_valuation_basis: 'latest 409A valuation', exercise_price_basis: 'fair market value at time of grant' });
    expect(plan.warnings.map((warning) => warning.message).join(' ')).toContain('reference_valuation_per_share: 0.07');
  });
});
