import { addMonths } from './vesting';
import type { CompensationInput, CompanyInput, DeadlineInput, DocumentInput, InstrumentTypeInput, PositionInput, VestingScheduleInput } from '../shared/types';
export class ValidationError extends Error { constructor(message: string) { super(message); this.name = 'ValidationError'; } }
const lengths = { name: 200, sector: 150, website: 2048, summary: 10000, members: 5000, cadence: 100, notes: 10000, currency: 3, instrumentName: 100, description: 2000, documentType: 100, filePath: 32767, fileName: 1024, documentDescription: 10000 };
const nullableText = (value: unknown, field: string, max: number): string | null => { if (value == null) return null; if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`); const clean = value.trim(); if (clean.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer.`); return clean || null; };
const requiredText = (value: unknown, field: string, max: number): string => { const clean = nullableText(value, field, max); if (!clean) throw new ValidationError(`${field} is required.`); return clean; };
export const validDate = (value: unknown, field: string): string | null => { if (value == null || value === '') return null; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${field} must be a valid YYYY-MM-DD date.`); const parsed = new Date(`${value}T00:00:00Z`); if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ValidationError(`${field} must be a valid calendar date.`); return value; };
const nullableNumber = (value: unknown, field: string, minimum: number, maximum: number): number | null => { if (value == null || value === '') return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new ValidationError(`${field} must be between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`); return value; };
export const positiveId = (value: unknown, field: string): number => { if (!Number.isInteger(value) || (value as number) < 1) throw new ValidationError(`${field} must be a valid record id.`); return value as number; };

export function validateCompany(input: CompanyInput): Required<CompanyInput> { const boardSize = input.board_size == null || input.board_size === ('' as never) ? null : input.board_size; if (boardSize !== null && (!Number.isInteger(boardSize) || boardSize < 0 || boardSize > 100000)) throw new ValidationError('Board size must be a whole number between 0 and 100,000.'); return { name: requiredText(input.name, 'Company name', lengths.name), business_summary: nullableText(input.business_summary, 'Business summary', lengths.summary), sector: nullableText(input.sector, 'Sector', lengths.sector), website: nullableText(input.website, 'Website', lengths.website), board_size: boardSize, other_board_members: nullableText(input.other_board_members, 'Other board members', lengths.members), meeting_cadence: nullableText(input.meeting_cadence, 'Meeting cadence', lengths.cadence), notes: nullableText(input.notes, 'Notes', lengths.notes) }; }
export function validatePosition(input: PositionInput): Required<PositionInput> { const company_id = positiveId(input.company_id, 'Company'); if (!['current', 'former', 'potential'].includes(input.status)) throw new ValidationError('Status is invalid.'); if (!['governing_board', 'advisory_board', 'advisor'].includes(input.position_type)) throw new ValidationError('Position type is invalid.'); const start_date = validDate(input.start_date, 'Start date'); const end_date = validDate(input.end_date, 'End date'); const expected_decision_date = validDate(input.expected_decision_date, 'Expected decision date'); if (start_date && end_date && end_date < start_date) throw new ValidationError('End date cannot be before start date.'); return { company_id, status: input.status, position_type: input.position_type, start_date, end_date, expected_decision_date: input.status === 'potential' ? expected_decision_date : null, notes: nullableText(input.notes, 'Notes', lengths.notes) }; }
export function validateDeadline(input: DeadlineInput): Required<DeadlineInput> {
  if (!['board_meeting', 'decision', 'filing', 'document', 'review', 'payment', 'other'].includes(input.deadline_type)) throw new ValidationError('Deadline type is invalid.');
  const due_date = validDate(input.due_date, 'Due date');
  if (!due_date) throw new ValidationError('Due date is required.');
  return { company_id: input.company_id == null || input.company_id === ('' as never) ? null : positiveId(input.company_id, 'Company'), position_id: input.position_id == null || input.position_id === ('' as never) ? null : positiveId(input.position_id, 'Position'), title: requiredText(input.title, 'Deadline', lengths.name), deadline_type: input.deadline_type, due_date, notes: nullableText(input.notes, 'Notes', lengths.notes) };
}

export function validateInstrumentType(input: InstrumentTypeInput): Required<InstrumentTypeInput> { return { name: requiredText(input.name, 'Instrument type name', lengths.instrumentName), description: nullableText(input.description, 'Instrument type description', lengths.description) }; }

export function validateCompensation(input: CompensationInput): { position_id: number; type: 'cash' | 'non_cash'; amount: number | null; currency: string | null; frequency: CompensationInput['frequency']; instrument_type_id: number | null; quantity: number | null; grant_price: number | null; grant_date: string | null; notes: string | null; } {
  const position_id = positiveId(input.position_id, 'Position');
  const type = input.type ?? 'cash';
  if (!['cash', 'non_cash'].includes(type)) throw new ValidationError('Compensation type is invalid.');
  const notes = nullableText(input.notes, 'Notes', lengths.notes);
  if (type === 'cash') {
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000_000_000) throw new ValidationError('Amount must be greater than zero and no more than 1,000,000,000,000.');
    const currency = requiredText(input.currency ?? 'USD', 'Currency', lengths.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError('Currency must be a three-letter ISO code.');
    if (!['one_time', 'annual', 'quarterly', 'monthly', 'per_meeting'].includes(input.frequency ?? '')) throw new ValidationError('Frequency is invalid.');
    return { position_id, type, amount: input.amount, currency, frequency: input.frequency!, instrument_type_id: null, quantity: null, grant_price: null, grant_date: null, notes };
  }
  const instrument_type_id = positiveId(input.instrument_type_id, 'Instrument type');
  const quantity = nullableNumber(input.quantity, 'Quantity', Number.MIN_VALUE, 1_000_000_000_000);
  if (quantity == null) throw new ValidationError('Quantity is required for non-cash compensation.');
  return { position_id, type, amount: null, currency: null, frequency: null, instrument_type_id, quantity, grant_price: nullableNumber(input.grant_price, 'Grant price', 0, 1_000_000_000_000), grant_date: validDate(input.grant_date, 'Grant date'), notes };
}

/** A vesting term is a whole number of months. Ten years is generous headroom for a real award. */
export function validDurationMonths(value: unknown): number | null {
  if (value == null || value === '') return null;
  const months = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(months)) throw new ValidationError('Vesting term must be a number of months.');
  if (!Number.isInteger(months)) throw new ValidationError('Vesting term must be a whole number of months.');
  if (months < 1 || months > 600) throw new ValidationError('Vesting term must be between 1 and 600 months.');
  return months;
}

export function validateVestingSchedule(input: VestingScheduleInput): { compensation_id: number; schedule_type: VestingScheduleInput['schedule_type']; cliff_date: string | null; vesting_start: string | null; vesting_end: string | null; duration_months: number | null; cadence: VestingScheduleInput['cadence']; notes: string | null; } {
  const compensation_id = positiveId(input.compensation_id, 'Compensation');
  if (!['immediate', 'cliff_linear', 'milestone', 'custom'].includes(input.schedule_type)) throw new ValidationError('Vesting schedule type is invalid.');
  const cadenceInput = (input.cadence as unknown) === '' ? null : input.cadence;
  if (cadenceInput != null && !['monthly', 'quarterly', 'annual', 'one_time'].includes(cadenceInput)) throw new ValidationError('Vesting cadence is invalid.');
  const cliff_date = validDate(input.cliff_date, 'Cliff date');
  const vesting_start = validDate(input.vesting_start, 'Vesting start');
  const vesting_end = validDate(input.vesting_end, 'Vesting end');
  const notes = nullableText(input.notes, 'Vesting notes', lengths.notes);
  const duration_months = validDurationMonths(input.duration_months);
  if (input.schedule_type === 'cliff_linear') {
    // An agreement gives you either an end date or a term. Requiring both would have made most
    // real awards unrecordable; requiring neither would make percent vested a guess.
    if (!cliff_date || !vesting_start) throw new ValidationError('Cliff date and vesting start are required for a cliff and linear schedule.');
    if (!vesting_end && duration_months == null) throw new ValidationError('Give a vesting end date or a vesting term in months for a cliff and linear schedule.');
    if (vesting_start > cliff_date) throw new ValidationError('Vesting dates must be ordered start, cliff, then end.');
    const end = vesting_end ?? addMonths(vesting_start, duration_months as number);
    if (!end || cliff_date > end) throw new ValidationError('Vesting dates must be ordered start, cliff, then end.');
    if (end <= vesting_start) throw new ValidationError('Vesting must end after it starts.');
    return { compensation_id, schedule_type: input.schedule_type, cliff_date, vesting_start, vesting_end, duration_months, cadence: cadenceInput ?? null, notes };
  }
  if ((input.schedule_type === 'milestone' || input.schedule_type === 'custom') && !notes) throw new ValidationError('Vesting notes are required for milestone and custom schedules.');
  return { compensation_id, schedule_type: input.schedule_type, cliff_date: null, vesting_start: null, vesting_end: null, duration_months: null, cadence: null, notes: input.schedule_type === 'immediate' ? null : notes };
}

export function validateDocument(input: DocumentInput): { company_id: number; position_id: number | null; compensation_id: number | null; document_type: string; file_path: string | null; file_name: string | null; description: string | null; document_date: string | null; status: 'linked' | 'missing'; } {
  const company_id = positiveId(input.company_id, 'Company');
  const position_id = input.position_id == null || input.position_id === ('' as never) ? null : positiveId(input.position_id, 'Position');
  const compensation_id = input.compensation_id == null || input.compensation_id === ('' as never) ? null : positiveId(input.compensation_id, 'Compensation');
  const document_type = requiredText(input.document_type, 'Document type', lengths.documentType);
  if (!['linked', 'missing'].includes(input.status)) throw new ValidationError('Document status is invalid.');
  const file_path = nullableText(input.file_path, 'File path', lengths.filePath);
  const file_name = nullableText(input.file_name, 'File name', lengths.fileName);
  const description = nullableText(input.description, 'Document description', lengths.documentDescription);
  const document_date = validDate(input.document_date, 'Document date');
  if (input.status === 'linked') { if (!file_path) throw new ValidationError('File path is required for a linked document.'); if (!file_name) throw new ValidationError('File name is required for a linked document.'); return { company_id, position_id, compensation_id, document_type, file_path, file_name, description, document_date, status: 'linked' }; }
  if (file_path) throw new ValidationError('File path must be empty for a missing document.');
  return { company_id, position_id, compensation_id, document_type, file_path: null, file_name: null, description, document_date, status: 'missing' };
}
