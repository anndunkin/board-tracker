import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BoardTrackerDatabase } from '../src/main/database';
import type { CompanyInput, PositionInput } from '../src/shared/types';
export function testDatabase(): { db: BoardTrackerDatabase; cleanup: () => void } { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'board-tracker-test-')); const file = path.join(directory, 'test.db'); const db = new BoardTrackerDatabase(file); return { db, cleanup: () => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } }; }
export const companyInput = (name = 'Example Corp'): CompanyInput => ({ name, business_summary: 'A useful company.', sector: 'Technology', website: 'example.test', board_size: 7, other_board_members: 'Ada Lovelace', meeting_cadence: 'Quarterly', notes: 'Initial notes' });
export const positionInput = (company_id: number, overrides: Partial<PositionInput> = {}): PositionInput => ({ company_id, status: 'current', position_type: 'governing_board', start_date: '2026-01-01', end_date: null, expected_decision_date: null, notes: 'Position notes', ...overrides });
