import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDatabase, companyInput, positionInput } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
let db: BoardTrackerDatabase; let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());
describe('boundary: company validation', () => {
 it.each([['empty',''],['spaces','   '],['long','x'.repeat(201)]])('rejects %s company name', (_kind, name) => expect(() => db.createCompany(companyInput(name))).toThrow());
 it.each([-1, 1.2, 100001])('rejects invalid board size %s', (board_size) => expect(() => db.createCompany({ ...companyInput(), board_size })).toThrow());
 it('accepts zero board size', () => expect(db.createCompany({ ...companyInput(), board_size: 0 }).board_size).toBe(0));
 it.each([['summary','business_summary',10001],['sector','sector',151],['website','website',2049],['members','other_board_members',5001],['cadence','meeting_cadence',101],['notes','notes',10001]] as const)('rejects oversized %s', (_label, field, length) => expect(() => db.createCompany({ ...companyInput(), [field]: 'x'.repeat(length) })).toThrow());
 it('rejects duplicate normalized names', () => { db.createCompany(companyInput('Same Name')); expect(() => db.createCompany(companyInput('Same Name'))).toThrow(); });
});
describe('boundary: positions', () => {
 it.each(['2026-02-30','2026-13-01','not-a-date','2026/01/01'])('rejects invalid date %s', (start_date) => { const c = db.createCompany(companyInput()); expect(() => db.createPosition(positionInput(c.id, { start_date }))).toThrow(); });
 it('rejects end dates before start dates', () => { const c = db.createCompany(companyInput()); expect(() => db.createPosition(positionInput(c.id, { start_date: '2026-04-02', end_date: '2026-04-01' }))).toThrow(); });
 it.each(['bad-status','', 'CURRENT'])('rejects invalid status %s', (status) => { const c = db.createCompany(companyInput()); expect(() => db.createPosition(positionInput(c.id, { status: status as never }))).toThrow(); });
 it.each(['director','', 'GOVERNING_BOARD'])('rejects invalid position type %s', (position_type) => { const c = db.createCompany(companyInput()); expect(() => db.createPosition(positionInput(c.id, { position_type: position_type as never }))).toThrow(); });
 it.each([0,-1,1.5])('rejects invalid company ids', (company_id) => expect(() => db.createPosition(positionInput(company_id))).toThrow());
});
describe('boundary: compensation and deletes', () => {
 it.each([-1,0,Number.NaN,Number.POSITIVE_INFINITY,1_000_000_000_001])('rejects invalid amount %s', (amount) => { const c = db.createCompany(companyInput()); const p = db.createPosition(positionInput(c.id)); expect(() => db.createCompensation({ position_id: p.id, amount, frequency: 'annual' })).toThrow(); });
 it('accepts smallest positive amount', () => { const c = db.createCompany(companyInput()); const p = db.createPosition(positionInput(c.id)); expect(db.createCompensation({ position_id: p.id, amount: 0.01, frequency: 'annual' }).amount).toBe(.01); });
 it.each(['US','USDD','12$', '   '])('rejects invalid currency %s', (currency) => { const c = db.createCompany(companyInput()); const p = db.createPosition(positionInput(c.id)); expect(() => db.createCompensation({ position_id: p.id, amount: 1, currency, frequency: 'annual' })).toThrow(); });
 it.each(['weekly','', 'Annual'])('rejects invalid frequency %s', (frequency) => { const c = db.createCompany(companyInput()); const p = db.createPosition(positionInput(c.id)); expect(() => db.createCompensation({ position_id: p.id, amount: 1, frequency: frequency as never })).toThrow(); });
 it('rejects deletes of records that do not exist', () => { expect(() => db.deleteCompany(999)).toThrow(); expect(() => db.deletePosition(999)).toThrow(); expect(() => db.deleteCompensation(999)).toThrow(); });
});
