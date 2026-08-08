import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { testDatabase, companyInput, nonCashInput, positionInput } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
let db: BoardTrackerDatabase; let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());
const nonCashContext = () => { const company = db.createCompany(companyInput()); const position = db.createPosition(positionInput(company.id)); const stock = db.listInstrumentTypes().find((item) => item.name === 'Stock')!; return { company, position, stock }; };

describe('security: parameterized queries', () => {
  const injections = ["' OR 1=1 --", "x'); DROP TABLE companies; --", '" OR ""="', "%' UNION SELECT 1 --", "admin'--"];
  it.each(injections)('stores SQL injection text safely: %s', (payload) => { const company = db.createCompany(companyInput(`Safe ${payload}`)); expect(db.getCompany(company.id)?.name).toBe(`Safe ${payload}`); expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").pluck().get()).toBe('companies'); });
  it.each(injections)('does not expand company search using injection input: %s', (payload) => { db.createCompany(companyInput('Alpha')); db.createCompany(companyInput('Beta')); expect(db.listCompanies(payload)).toEqual([]); });
  it.each(['business_summary', 'sector', 'website', 'other_board_members', 'meeting_cadence', 'notes'] as const)('parameterizes company text field %s', (field) => { const payload = "x'); DROP TABLE positions; --"; const company = db.createCompany({ ...companyInput('Field Test'), [field]: payload }); expect(db.getCompany(company.id)?.[field]).toBe(payload); expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='positions'").pluck().get()).toBe('positions'); });
  it('parameterizes non-cash compensation, instrument type, and vesting notes', () => { const { company, position, stock } = nonCashContext(); const payload = "'); DELETE FROM companies; --"; const custom = db.createInstrumentType({ name: `Units ${payload}`, description: payload }); const compensation = db.createCompensation(nonCashInput(position.id, stock.id, { notes: payload })); const schedule = db.createVestingSchedule({ compensation_id: compensation.id, schedule_type: 'custom', notes: payload }); expect(custom.description).toBe(payload); expect(compensation.notes).toBe(payload); expect(schedule.notes).toBe(payload); expect(db.getCompany(company.id)?.name).toBe('Example Corp'); });
});

describe('security: XSS-safe persistence and rendering', () => {
  const payloads = ['<script>window.pwned=true</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '" autofocus onfocus=alert(1) x="'];
  it.each(payloads)('stores XSS text in new text fields without execution: %s', (payload) => { const { position, stock } = nonCashContext(); const type = db.createInstrumentType({ name: `Type ${payload}`, description: payload }); const compensation = db.createCompensation(nonCashInput(position.id, stock.id, { notes: payload })); const schedule = db.createVestingSchedule({ compensation_id: compensation.id, schedule_type: 'custom', notes: payload }); expect(type.description).toBe(payload); expect(schedule.notes).toBe(payload); expect(compensation.notes).toBe(payload); });
  it.each(payloads)('React escapes XSS payload in rendered text: %s', (payload) => { const html = renderToStaticMarkup(createElement('p', null, payload)); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img '); expect(html).not.toContain(payload); expect(html).toMatch(/&lt;|&quot;/); });
});
