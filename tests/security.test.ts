import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { testDatabase, companyInput, positionInput } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
let db: BoardTrackerDatabase; let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());
describe('security: parameterized queries', () => {
 const injections = ["' OR 1=1 --", "x'); DROP TABLE companies; --", '" OR ""="', "%' UNION SELECT 1 --", 'admin\'--'];
 it.each(injections)('stores SQL injection text safely: %s', (payload) => { const c = db.createCompany(companyInput(`Safe ${payload}`)); expect(db.getCompany(c.id)?.name).toBe(`Safe ${payload}`); expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").pluck().get()).toBe('companies'); });
 it.each(injections)('does not expand company search using injection input: %s', (payload) => { db.createCompany(companyInput('Alpha')); db.createCompany(companyInput('Beta')); expect(db.listCompanies(payload)).toEqual([]); });
 it.each(['business_summary','sector','website','other_board_members','meeting_cadence','notes'] as const)('parameterizes company text field %s', (field) => { const payload = "x'); DROP TABLE positions; --"; const c = db.createCompany({ ...companyInput('Field Test'), [field]: payload }); expect(db.getCompany(c.id)?.[field]).toBe(payload); expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='positions'").pluck().get()).toBe('positions'); });
 it.each(['notes'] as const)('parameterizes position %s', (field) => { const c = db.createCompany(companyInput()); const p = db.createPosition({ ...positionInput(c.id), [field]: "'); DELETE FROM companies; --" }); expect(p.notes).toContain('DELETE'); expect(db.listCompanies()).toHaveLength(1); });
 it.each(['notes'] as const)('parameterizes compensation %s', (field) => { const c = db.createCompany(companyInput()); const p = db.createPosition(positionInput(c.id)); const cash = db.createCompensation({ position_id: p.id, amount: 1, frequency: 'one_time', [field]: "'); DELETE FROM positions; --" }); expect(cash.notes).toContain('DELETE'); expect(db.getCompany(c.id)?.positions).toHaveLength(1); });
});
describe('security: XSS-safe persistence and rendering', () => {
 const payloads = ['<script>window.pwned=true</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '" autofocus onfocus=alert(1) x="'];
 it.each(payloads)('stores XSS text without execution: %s', (payload) => { const c = db.createCompany({ ...companyInput('XSS test'), notes: payload }); expect(db.getCompany(c.id)?.notes).toBe(payload); });
 it.each(payloads)('React escapes XSS payload in rendered text: %s', (payload) => { const html = renderToStaticMarkup(createElement('p', null, payload)); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img '); expect(html).not.toContain(payload); expect(html).toMatch(/&lt;|&quot;/); });
});
