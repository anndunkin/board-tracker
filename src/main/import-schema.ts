import { ValidationError } from './validation';
import type { CompensationFrequency, CompensationType, DocumentStatus, ImportCompanyNode, ImportCompensationNode, ImportDocumentNode, ImportPayload, ImportPositionNode, ImportVestingNode, PositionStatus, PositionType, VestingCadence, VestingScheduleType } from '../shared/types';

export const IMPORT_SCHEMA_ID = 'board-tracker.import';
export const IMPORT_SCHEMA_VERSION = 1;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_COMPANIES = 500;
const MAX_CHILDREN = 200;
const limits = { name: 200, sector: 150, website: 2048, summary: 10000, members: 5000, cadence: 100, notes: 10000, instrument: 100, documentType: 100, filePath: 32767, fileName: 1024, description: 10000, label: 500 };

const positionStatuses: PositionStatus[] = ['current', 'former', 'potential'];
const positionTypes: PositionType[] = ['governing_board', 'advisory_board', 'advisor'];
const compensationTypes: CompensationType[] = ['cash', 'non_cash'];
const frequencies: CompensationFrequency[] = ['one_time', 'annual', 'quarterly', 'monthly', 'per_meeting'];
const scheduleTypes: VestingScheduleType[] = ['immediate', 'cliff_linear', 'milestone', 'custom'];
const cadences: VestingCadence[] = ['monthly', 'quarterly', 'annual', 'one_time'];
const documentStatuses: DocumentStatus[] = ['linked', 'missing'];

const fail = (path: string, message: string): never => { throw new ValidationError(`${path}: ${message}`); };
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown, path: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return fail(path, 'must be text.');
  // Strip control characters that could corrupt display or logs, then trim.
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (clean.length > max) return fail(path, `must be ${max} characters or fewer.`);
  return clean || null;
}
const requiredText = (value: unknown, path: string, max: number): string => text(value, path, max) ?? fail(path, 'is required.');

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
  if (value == null || value === '') { if (fallback !== undefined) return fallback; return fail(path, `is required and must be one of: ${allowed.join(', ')}.`); }
  if (typeof value !== 'string' || !allowed.includes(value as T)) return fail(path, `must be one of: ${allowed.join(', ')}.`);
  return value as T;
}

function list(value: unknown, path: string, max = MAX_CHILDREN): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) return fail(path, 'must be an array.');
  if (value.length > max) return fail(path, `must contain ${max} entries or fewer.`);
  return value;
}

function node(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) return fail(path, 'must be an object.');
  return value;
}

/** The per-record extraction payload kept verbatim for the audit trail. */
function extracted(value: unknown, path: string): string | null {
  if (value == null) return null;
  if (!isPlainObject(value) && !Array.isArray(value)) return fail(path, 'must be an object or array.');
  const serialized = JSON.stringify(value);
  if (serialized.length > 200_000) return fail(path, 'must be 200,000 characters or fewer when serialized.');
  return serialized;
}

function parseVesting(value: unknown, path: string): ImportVestingNode | null {
  if (value == null) return null;
  const raw = node(value, path);
  const schedule_type = oneOf(raw.schedule_type, `${path}.schedule_type`, scheduleTypes);
  return {
    schedule_type,
    cliff_date: date(raw.cliff_date, `${path}.cliff_date`),
    vesting_start: date(raw.vesting_start, `${path}.vesting_start`),
    vesting_end: date(raw.vesting_end, `${path}.vesting_end`),
    cadence: raw.cadence == null || raw.cadence === '' ? null : oneOf(raw.cadence, `${path}.cadence`, cadences),
    notes: text(raw.notes, `${path}.notes`, limits.notes),
  };
}

function parseDocument(value: unknown, path: string): ImportDocumentNode {
  const raw = node(value, path);
  const status = oneOf(raw.status, `${path}.status`, documentStatuses, 'missing');
  const file_path = text(raw.file_path, `${path}.file_path`, limits.filePath);
  const file_name = text(raw.file_name, `${path}.file_name`, limits.fileName);
  if (status === 'linked' && !file_path) fail(`${path}.file_path`, 'is required when status is "linked".');
  if (status === 'missing' && file_path) fail(`${path}.file_path`, 'must be omitted when status is "missing".');
  return {
    document_type: requiredText(raw.document_type, `${path}.document_type`, limits.documentType),
    status,
    file_path,
    file_name: status === 'linked' ? file_name ?? (file_path as string).split(/[\\/]/).pop() ?? null : null,
    description: text(raw.description, `${path}.description`, limits.description),
    document_date: date(raw.document_date, `${path}.document_date`),
    extracted_data_json: extracted(raw.extracted_data, `${path}.extracted_data`),
  };
}

function parseCompensation(value: unknown, path: string): ImportCompensationNode {
  const raw = node(value, path);
  const type = oneOf(raw.type, `${path}.type`, compensationTypes, 'cash');
  const notes = text(raw.notes, `${path}.notes`, limits.notes);
  const documents = list(raw.documents, `${path}.documents`).map((item, index) => parseDocument(item, `${path}.documents[${index}]`));
  const extracted_data_json = extracted(raw.extracted_data, `${path}.extracted_data`);
  const vesting = parseVesting(raw.vesting, `${path}.vesting`);
  if (type === 'cash') {
    const amount = num(raw.amount, `${path}.amount`, Number.MIN_VALUE, 1_000_000_000_000) ?? fail(`${path}.amount`, 'is required for cash compensation.');
    const currency = (text(raw.currency, `${path}.currency`, 3) ?? 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail(`${path}.currency`, 'must be a three-letter ISO code.');
    return { type, amount, currency, frequency: oneOf(raw.frequency, `${path}.frequency`, frequencies), instrument_type: null, quantity: null, grant_price: null, grant_date: null, notes, vesting: null, documents, extracted_data_json };
  }
  return {
    type,
    amount: null, currency: null, frequency: null,
    instrument_type: requiredText(raw.instrument_type, `${path}.instrument_type`, limits.instrument),
    quantity: num(raw.quantity, `${path}.quantity`, Number.MIN_VALUE, 1_000_000_000_000) ?? fail(`${path}.quantity`, 'is required for non-cash compensation.'),
    grant_price: num(raw.grant_price, `${path}.grant_price`, 0, 1_000_000_000_000),
    grant_date: date(raw.grant_date, `${path}.grant_date`),
    notes, vesting, documents, extracted_data_json,
  };
}

function parsePosition(value: unknown, path: string): ImportPositionNode {
  const raw = node(value, path);
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
    compensation: list(raw.compensation, `${path}.compensation`).map((item, index) => parseCompensation(item, `${path}.compensation[${index}]`)),
    documents: list(raw.documents, `${path}.documents`).map((item, index) => parseDocument(item, `${path}.documents[${index}]`)),
  };
}

function parseCompany(value: unknown, path: string): ImportCompanyNode {
  const raw = node(value, path);
  const fieldsRaw = isPlainObject(raw.fields) ? raw.fields : {};
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

export function parseImportPayload(parsed: unknown, sourceLabel: string): ImportPayload {
  const raw = node(parsed, 'file');
  if (raw.schema !== IMPORT_SCHEMA_ID) throw new ValidationError(`file.schema must be "${IMPORT_SCHEMA_ID}".`);
  const version = integer(raw.schema_version, 'file.schema_version', 1, 1000) ?? fail('file.schema_version', 'is required.');
  if (version > IMPORT_SCHEMA_VERSION) throw new ValidationError(`This file uses import schema version ${version}, but this version of Board Tracker supports up to version ${IMPORT_SCHEMA_VERSION}.`);
  const sourceRaw = isPlainObject(raw.source) ? raw.source : {};
  const companies = list(raw.companies, 'file.companies', MAX_COMPANIES);
  if (!companies.length) throw new ValidationError('file.companies: must contain at least one company.');
  const parsedCompanies = companies.map((item, index) => parseCompany(item, `file.companies[${index}]`));
  const seen = new Set<string>();
  parsedCompanies.forEach((company, index) => {
    const key = company.name.toLowerCase();
    if (seen.has(key)) fail(`file.companies[${index}].name`, `is listed more than once ("${company.name}"). Combine the entries into one company.`);
    seen.add(key);
  });
  return {
    schema_version: version,
    generated_at: date(raw.generated_at, 'file.generated_at'),
    source: {
      label: sourceLabel.slice(0, limits.label),
      tool: text(sourceRaw.tool, 'file.source.tool', limits.name),
      reference: text(sourceRaw.reference, 'file.source.reference', limits.website),
      notes: text(sourceRaw.notes, 'file.source.notes', limits.notes),
    },
    companies: parsedCompanies,
    payload_json: JSON.stringify(parsed),
  };
}
