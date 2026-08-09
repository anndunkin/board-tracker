import { ValidationError } from './validation';
import { cadences, compensationTypes, documentStatuses, frequencies, positionStatuses, positionTypes, scheduleTypes } from '../shared/import-constants';
import type { ImportCompanyNode, ImportCompensationNode, ImportDocumentNode, ImportNotice, ImportPayload, ImportPositionNode, ImportVestingNode } from '../shared/types';

export const IMPORT_SCHEMA_ID = 'board-tracker.import';
export const IMPORT_SCHEMA_VERSION = 1;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_COMPANIES = 500;
const MAX_CHILDREN = 200;
const MAX_REPORTED_PROBLEMS = 100;
const limits = { name: 200, sector: 150, website: 2048, summary: 10000, members: 5000, cadence: 100, notes: 10000, instrument: 100, documentType: 100, filePath: 32767, fileName: 1024, description: 10000, label: 500 };

/**
 * Pure renames only. An alias moves a value to the field it obviously belongs in; it never
 * reinterprets the value itself, so `vesting_type: "cliff_then_monthly"` still fails validation on
 * the value even though the key is accepted. Every alias applied is reported back to the user.
 */
const companyAliases: Record<string, string> = { company_name: 'name' };
const companyFieldKeys = ['business_summary', 'sector', 'website', 'board_size', 'other_board_members', 'meeting_cadence', 'notes'];
const positionAliases: Record<string, string> = { position_status: 'status', role_type: 'position_type' };
const compensationAliases: Record<string, string> = { compensation_type: 'type', instrument: 'instrument_type', instrument_name: 'instrument_type', exercise_price: 'grant_price', shares: 'quantity' };
const vestingAliases: Record<string, string> = { vesting_type: 'schedule_type', commencement_date: 'vesting_start', vesting_commencement_date: 'vesting_start', start_date: 'vesting_start', end_date: 'vesting_end', post_cliff_period: 'cadence', vesting_cadence: 'cadence' };
const documentAliases: Record<string, string> = { path: 'file_path', name: 'file_name', filename: 'file_name', date: 'document_date' };

// Alias keys are deliberately absent from these sets. A consumed alias is deleted by applyAliases,
// so anything still bearing an alias name lost to a canonical field that was also present — and must
// be reported as untracked rather than quietly discarded.
const companyKeys = new Set(['name', 'fields', 'positions', 'documents', 'extracted_data', ...companyFieldKeys]);
const companyFieldsKeys = new Set(companyFieldKeys);
const positionKeys = new Set(['status', 'position_type', 'start_date', 'end_date', 'expected_decision_date', 'notes', 'compensation', 'documents', 'extracted_data']);
const compensationKeys = new Set(['type', 'amount', 'currency', 'frequency', 'instrument_type', 'quantity', 'grant_price', 'grant_date', 'notes', 'vesting', 'documents', 'extracted_data']);
const vestingKeys = new Set(['schedule_type', 'cliff_date', 'vesting_start', 'vesting_end', 'cadence', 'notes', 'extracted_data']);
const documentKeys = new Set(['document_type', 'status', 'file_path', 'file_name', 'description', 'document_date', 'extracted_data']);

// Parsing is fully synchronous, so a module-scoped collector is safe here and keeps every helper
// signature unchanged. It is installed and torn down by parseImportPayload.
type Collector = { problems: string[]; notices: ImportNotice[] };
let collector: Collector = { problems: [], notices: [] };

const fail = (path: string, message: string): any => { if (collector.problems.length < MAX_REPORTED_PROBLEMS) collector.problems.push(`${path}: ${message}`); return null; };
const notice = (path: string, message: string, kind: ImportNotice['kind']): void => { collector.notices.push({ path, message, kind }); };
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown, path: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return fail(path, 'must be text.');
  // Strip control characters that could corrupt display or logs, then trim.
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (clean.length > max) return fail(path, `must be ${max} characters or fewer.`);
  return clean || null;
}
const requiredText = (value: unknown, path: string, max: number): string => { const parsed = text(value, path, max); if (parsed != null) return parsed; fail(path, 'is required.'); return ''; };

function date(value: unknown, path: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail(path, 'must be a YYYY-MM-DD date.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return fail(path, 'must be a real calendar date.');
  return value;
}

function num(value: unknown, path: string, min: number, max: number): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'must be a number.');
  if (value < min || value > max) return fail(path, `must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`);
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number | null {
  const parsed = num(value, path, min, max);
  if (parsed != null && !Number.isInteger(parsed)) return fail(path, 'must be a whole number.');
  return parsed;
}

function oneOf<T extends string>(value: unknown, path: string, allowed: T[], fallback?: T): T {
  if (value == null || value === '') { if (fallback !== undefined) return fallback; fail(path, `is required and must be one of: ${allowed.join(', ')}.`); return allowed[0]; }
  if (typeof value !== 'string' || !allowed.includes(value as T)) { fail(path, `must be one of: ${allowed.join(', ')}.${typeof value === 'string' ? ` Found "${value}".` : ''}`); return allowed[0]; }
  return value as T;
}

function list(value: unknown, path: string, max = MAX_CHILDREN): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) { fail(path, 'must be an array.'); return []; }
  if (value.length > max) { fail(path, `must contain ${max} entries or fewer.`); return value.slice(0, max); }
  return value;
}

function node(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) { fail(path, 'must be an object.'); return {}; }
  return value;
}

/** Renames alias keys onto their canonical names, reporting each one it applies. */
function applyAliases(raw: Record<string, unknown>, aliases: Record<string, string>, path: string): Record<string, unknown> {
  const mapped: Record<string, unknown> = { ...raw };
  for (const [from, to] of Object.entries(aliases)) {
    if (!(from in mapped) || mapped[from] == null) continue;
    if (mapped[to] != null) continue; // the canonical field wins; the alias is reported as unmapped
    mapped[to] = mapped[from];
    delete mapped[from];
    notice(`${path}.${from}`, `Read "${from}" as "${to}".`, 'alias');
  }
  return mapped;
}

/**
 * Everything in the file that this schema has no column for. It is kept in the record's audit
 * payload and listed in the review screen with its values, so the user can see exactly what came
 * across and move anything important into a real field. It is never written into notes, which
 * would overwrite text the user wrote and turn every re-import into a conflict.
 */
function unmappedOf(raw: Record<string, unknown>, known: Set<string>, path: string): Record<string, unknown> | null {
  const extras = Object.keys(raw).filter((key) => !known.has(key) && raw[key] != null);
  if (!extras.length) return null;
  const preview = extras.map((key) => { const value = raw[key]; const rendered = typeof value === 'string' ? value : JSON.stringify(value); return `${key}: ${rendered.length > 80 ? `${rendered.slice(0, 79)}…` : rendered}`; });
  notice(path, `${extras.length} field${extras.length === 1 ? '' : 's'} kept but not tracked — ${preview.join('; ')}`, 'unmapped');
  return Object.fromEntries(extras.map((key) => [key, raw[key]]));
}

/** The per-record extraction payload kept verbatim for the audit trail, plus anything unmapped. */
function extracted(value: unknown, path: string, unmapped: Record<string, unknown> | null): string | null {
  if (value != null && !isPlainObject(value) && !Array.isArray(value)) { fail(path, 'must be an object or array.'); return null; }
  let payload: unknown = value ?? null;
  if (unmapped) payload = isPlainObject(payload) ? { ...payload, unmapped_fields: unmapped } : payload == null ? { unmapped_fields: unmapped } : { extracted_data: payload, unmapped_fields: unmapped };
  if (payload == null) return null;
  const serialized = JSON.stringify(payload);
  if (serialized.length > 200_000) { fail(path, 'must be 200,000 characters or fewer when serialized.'); return null; }
  return serialized;
}

function parseVesting(value: unknown, path: string): ImportVestingNode | null {
  if (value == null) return null;
  // Extractions routinely emit a list of schedules where the schema wants the one that applies.
  let source = value;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    if (value.length > 1) fail(path, `must be a single vesting object, but ${value.length} were listed. Keep the schedule that applies to this grant.`);
    else notice(path, 'Read the single-item vesting array as one vesting object.', 'alias');
    source = value[0];
  }
  const raw = applyAliases(node(source, path), vestingAliases, path);
  const unmapped = unmappedOf(raw, vestingKeys, path);
  return {
    schedule_type: oneOf(raw.schedule_type, `${path}.schedule_type`, scheduleTypes),
    cliff_date: date(raw.cliff_date, `${path}.cliff_date`),
    vesting_start: date(raw.vesting_start, `${path}.vesting_start`),
    vesting_end: date(raw.vesting_end, `${path}.vesting_end`),
    cadence: raw.cadence == null || raw.cadence === '' ? null : oneOf(raw.cadence, `${path}.cadence`, cadences),
    notes: text(raw.notes, `${path}.notes`, limits.notes),
    extracted_data_json: extracted(raw.extracted_data, `${path}.extracted_data`, unmapped),
  };
}

function parseDocument(value: unknown, path: string): ImportDocumentNode {
  const raw = applyAliases(node(value, path), documentAliases, path);
  const unmapped = unmappedOf(raw, documentKeys, path);
  const status = oneOf(raw.status, `${path}.status`, documentStatuses, 'missing');
  const file_path = text(raw.file_path, `${path}.file_path`, limits.filePath);
  const file_name = text(raw.file_name, `${path}.file_name`, limits.fileName);
  if (status === 'linked' && !file_path) fail(`${path}.file_path`, 'is required when status is "linked".');
  if (status === 'missing' && file_path) fail(`${path}.file_path`, 'must be omitted when status is "missing".');
  return {
    document_type: requiredText(raw.document_type, `${path}.document_type`, limits.documentType),
    status,
    file_path,
    file_name: status === 'linked' && file_path ? file_name ?? file_path.split(/[\\/]/).pop() ?? null : null,
    description: text(raw.description, `${path}.description`, limits.description),
    document_date: date(raw.document_date, `${path}.document_date`),
    extracted_data_json: extracted(raw.extracted_data, `${path}.extracted_data`, unmapped),
  };
}

function parseCompensation(value: unknown, path: string): ImportCompensationNode {
  const raw = applyAliases(node(value, path), compensationAliases, path);
  const type = oneOf(raw.type, `${path}.type`, compensationTypes, 'cash');
  // Only meaningful once the type is known, so it cannot ride along in the generic alias table.
  if (type === 'cash' && raw.amount == null && raw.cash_amount != null) { raw.amount = raw.cash_amount; delete raw.cash_amount; notice(`${path}.cash_amount`, 'Read "cash_amount" as "amount".', 'alias'); }
  const unmapped = unmappedOf(raw, compensationKeys, path);
  const notes = text(raw.notes, `${path}.notes`, limits.notes);
  const documents = list(raw.documents, `${path}.documents`).map((item, index) => parseDocument(item, `${path}.documents[${index}]`));
  const extracted_data_json = extracted(raw.extracted_data, `${path}.extracted_data`, unmapped);
  const vesting = parseVesting(raw.vesting, `${path}.vesting`);
  if (type === 'cash') {
    const amount = num(raw.amount, `${path}.amount`, Number.MIN_VALUE, 1_000_000_000_000);
    if (amount == null) fail(`${path}.amount`, 'is required for cash compensation.');
    const currency = (text(raw.currency, `${path}.currency`, 3) ?? 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail(`${path}.currency`, 'must be a three-letter ISO code.');
    return { type, amount: amount ?? 0, currency, frequency: oneOf(raw.frequency, `${path}.frequency`, frequencies), instrument_type: null, quantity: null, grant_price: null, grant_date: null, notes, vesting: null, documents, extracted_data_json };
  }
  const quantity = num(raw.quantity, `${path}.quantity`, Number.MIN_VALUE, 1_000_000_000_000);
  if (quantity == null) fail(`${path}.quantity`, 'is required for non-cash compensation.');
  return {
    type,
    amount: null, currency: null, frequency: null,
    instrument_type: requiredText(raw.instrument_type, `${path}.instrument_type`, limits.instrument),
    quantity: quantity ?? 0,
    grant_price: num(raw.grant_price, `${path}.grant_price`, 0, 1_000_000_000_000),
    grant_date: date(raw.grant_date, `${path}.grant_date`),
    notes, vesting, documents, extracted_data_json,
  };
}

function parsePosition(value: unknown, path: string): ImportPositionNode {
  const raw = applyAliases(node(value, path), positionAliases, path);
  const unmapped = unmappedOf(raw, positionKeys, path);
  const status = oneOf(raw.status, `${path}.status`, positionStatuses);
  const start_date = date(raw.start_date, `${path}.start_date`);
  const end_date = date(raw.end_date, `${path}.end_date`);
  if (start_date && end_date && end_date < start_date) fail(`${path}.end_date`, 'cannot be before start_date.');
  return {
    status,
    position_type: oneOf(raw.position_type, `${path}.position_type`, positionTypes),
    start_date, end_date,
    expected_decision_date: status === 'potential' ? date(raw.expected_decision_date, `${path}.expected_decision_date`) : null,
    notes: text(raw.notes, `${path}.notes`, limits.notes),
    extracted_data_json: extracted(raw.extracted_data, `${path}.extracted_data`, unmapped),
    compensation: list(raw.compensation, `${path}.compensation`).map((item, index) => parseCompensation(item, `${path}.compensation[${index}]`)),
    documents: list(raw.documents, `${path}.documents`).map((item, index) => parseDocument(item, `${path}.documents[${index}]`)),
  };
}

function parseCompany(value: unknown, path: string): ImportCompanyNode {
  const raw = applyAliases(node(value, path), companyAliases, path);
  const fieldsRaw: Record<string, unknown> = isPlainObject(raw.fields) ? { ...raw.fields } : {};
  // Profile fields are commonly emitted at the company level instead of inside "fields".
  for (const key of companyFieldKeys) {
    if (raw[key] == null || fieldsRaw[key] != null) continue;
    fieldsRaw[key] = raw[key];
    notice(`${path}.${key}`, `Read "${key}" as "fields.${key}".`, 'alias');
  }
  const unmapped = unmappedOf(raw, companyKeys, path);
  const fieldsUnmapped = unmappedOf(fieldsRaw, companyFieldsKeys, `${path}.fields`);
  const merged = unmapped || fieldsUnmapped ? { ...(unmapped ?? {}), ...(fieldsUnmapped ?? {}) } : null;
  return {
    name: requiredText(raw.name, `${path}.name`, limits.name),
    fields: {
      business_summary: text(fieldsRaw.business_summary, `${path}.fields.business_summary`, limits.summary),
      sector: text(fieldsRaw.sector, `${path}.fields.sector`, limits.sector),
      website: text(fieldsRaw.website, `${path}.fields.website`, limits.website),
      board_size: integer(fieldsRaw.board_size, `${path}.fields.board_size`, 0, 100000),
      other_board_members: text(fieldsRaw.other_board_members, `${path}.fields.other_board_members`, limits.members),
      meeting_cadence: text(fieldsRaw.meeting_cadence, `${path}.fields.meeting_cadence`, limits.cadence),
      notes: text(fieldsRaw.notes, `${path}.fields.notes`, limits.notes),
    },
    extracted_data_json: extracted(raw.extracted_data, `${path}.extracted_data`, merged),
    positions: list(raw.positions, `${path}.positions`).map((item, index) => parsePosition(item, `${path}.positions[${index}]`)),
    documents: list(raw.documents, `${path}.documents`).map((item, index) => parseDocument(item, `${path}.documents[${index}]`)),
  };
}

/** Parses raw JSON text produced by a Perplexity extraction session into a validated payload. */
export function parseImportFile(contents: string, sourceLabel: string): ImportPayload {
  if (typeof contents !== 'string' || !contents.trim()) throw new ValidationError('There is nothing to import — the file or pasted text is empty.');
  if (Buffer.byteLength(contents, 'utf8') > MAX_BYTES) throw new ValidationError('The import file must be 5 MB or smaller.');
  // People paste the whole chat reply, fenced block and all. Strip a leading ```json fence rather
  // than making them hand-edit it back out.
  const body = contents.trim().replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```$/, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new ValidationError('This is not valid JSON. Paste or load the JSON object the extraction produced, without the surrounding chat reply.'); }
  return parseImportPayload(parsed, sourceLabel);
}

/** Renders every problem found in one pass, so the file can be corrected in a single edit. */
function reportProblems(problems: string[]): never {
  const shown = problems.slice(0, 25);
  const extra = problems.length - shown.length;
  const header = problems.length === 1 ? 'Found 1 problem in this file:' : `Found ${problems.length}${problems.length >= MAX_REPORTED_PROBLEMS ? '+' : ''} problems in this file:`;
  throw new ValidationError([header, ...shown.map((problem) => `• ${problem}`), ...(extra > 0 ? [`• …and ${extra} more.`] : [])].join('\n'));
}

export function parseImportPayload(parsed: unknown, sourceLabel: string): ImportPayload {
  collector = { problems: [], notices: [] };
  try {
    // Structural: with nothing to walk there are no further problems to collect.
    if (!isPlainObject(parsed)) throw new ValidationError('file: must be an object.');
    const raw = parsed;
    if (raw.schema !== IMPORT_SCHEMA_ID) throw new ValidationError(`file.schema must be "${IMPORT_SCHEMA_ID}". Ask the extraction to emit the Board Tracker import schema, or attach docs/board-tracker.import.schema.json to the session.`);
    const version = integer(raw.schema_version, 'file.schema_version', 1, 1000);
    if (version == null) fail('file.schema_version', 'is required.');
    if (version != null && version > IMPORT_SCHEMA_VERSION) throw new ValidationError(`This file uses import schema version ${version}, but this version of Board Tracker supports up to version ${IMPORT_SCHEMA_VERSION}.`);
    const sourceRaw = isPlainObject(raw.source) ? raw.source : {};
    const companies = list(raw.companies, 'file.companies', MAX_COMPANIES);
    if (!companies.length) throw new ValidationError('file.companies: must contain at least one company.');
    const parsedCompanies = companies.map((item, index) => parseCompany(item, `file.companies[${index}]`));
    const seen = new Set<string>();
    parsedCompanies.forEach((company, index) => {
      const key = company.name.toLowerCase();
      if (!key) return;
      if (seen.has(key)) fail(`file.companies[${index}].name`, `is listed more than once ("${company.name}"). Combine the entries into one company.`);
      seen.add(key);
    });
    const payload: ImportPayload = {
      schema_version: version ?? IMPORT_SCHEMA_VERSION,
      generated_at: date(raw.generated_at, 'file.generated_at'),
      source: {
        label: sourceLabel.slice(0, limits.label),
        tool: text(sourceRaw.tool, 'file.source.tool', limits.name),
        reference: text(sourceRaw.reference, 'file.source.reference', limits.website),
        notes: text(sourceRaw.notes, 'file.source.notes', limits.notes),
      },
      companies: parsedCompanies,
      warnings: collector.notices,
      payload_json: JSON.stringify(parsed),
    };
    if (collector.problems.length) reportProblems(collector.problems);
    return payload;
  } finally {
    collector = { problems: [], notices: [] };
  }
}
