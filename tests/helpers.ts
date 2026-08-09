import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BoardTrackerDatabase } from '../src/main/database';
import type { CompanyInput, CompensationInput, DocumentInput, PositionInput } from '../src/shared/types';
export function testDatabase(): { db: BoardTrackerDatabase; cleanup: () => void } { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'board-tracker-test-')); const file = path.join(directory, 'test.db'); const db = new BoardTrackerDatabase(file); return { db, cleanup: () => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } }; }
export const companyInput = (name = 'Example Corp'): CompanyInput => ({ name, business_summary: 'A useful company.', sector: 'Technology', website: 'example.test', board_size: 7, other_board_members: 'Ada Lovelace', meeting_cadence: 'Quarterly', notes: 'Initial notes' });
export const positionInput = (company_id: number, overrides: Partial<PositionInput> = {}): PositionInput => ({ company_id, status: 'current', position_type: 'governing_board', start_date: '2026-01-01', end_date: null, expected_decision_date: null, notes: 'Position notes', ...overrides });
export const nonCashInput = (position_id: number, instrument_type_id: number, overrides: Partial<CompensationInput> = {}): CompensationInput => ({ position_id, type: 'non_cash', instrument_type_id, quantity: 1000, grant_price: 2.5, grant_date: '2026-01-01', notes: 'Equity grant', ...overrides });
/** A complete, valid import file. Pass overrides to swap in a different `companies` array or header field. */
export const importFile = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 'board-tracker.import',
  schema_version: 1,
  generated_at: '2026-08-09',
  source: { tool: 'Perplexity', reference: 'https://www.perplexity.ai/search/example', notes: 'Extracted from autobridge-advisor-agreement.pdf' },
  companies: [{
    name: 'AutoBridge Systems',
    fields: { sector: 'Automotive software', board_size: 6 },
    positions: [{
      status: 'current', position_type: 'advisory_board', start_date: '2026-03-01',
      compensation: [{ type: 'non_cash', instrument_type: 'Options', quantity: 25000, grant_price: 1.25, grant_date: '2026-03-01', extracted_data: { clause: '3(a)', confidence: 'high', quoted_text: '25,000 options at $1.25' }, vesting: { schedule_type: 'cliff_linear', vesting_start: '2026-03-01', cliff_date: '2027-03-01', vesting_end: '2030-03-01', cadence: 'monthly' } }],
    }],
    documents: [{ document_type: 'advisor_agreement', status: 'linked', file_path: 'C:\\Board Documents\\autobridge-advisor-agreement.pdf', document_date: '2026-03-01', description: 'Signed advisor agreement', extracted_data: { pages: 9, signed: true } }],
  }],
  ...overrides,
});
export const documentInput = (company_id: number, overrides: Partial<DocumentInput> = {}): DocumentInput => ({ company_id, position_id: null, compensation_id: null, document_type: 'board_agreement', file_path: 'C:\\Board Documents\\agreement.pdf', file_name: 'agreement.pdf', description: 'Signed agreement', document_date: '2026-01-01', status: 'linked', ...overrides });
