import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardTrackerDatabase } from '../src/main/database';
import { importSeedOnce } from '../src/main/seed';
import { buildDeadlineItems, daysUntil, dueLabel, urgencyFor, DUE_SOON_DAYS, type DeadlineRow } from '../src/shared/deadlines';
import { testDatabase, companyInput, nonCashInput, positionInput } from './helpers';

let db: BoardTrackerDatabase; let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());

const seedFile = [{ name: 'Seed One', sector: 'Energy' }, { name: 'Seed Two', sector: 'Software' }];

describe('deleted companies stay deleted', () => {
  it('imports the bundled seed companies the first time and reports what it did', () => {
    const result = importSeedOnce(db, () => seedFile);
    expect(result).toMatchObject({ inserted: 2, skipped: 0, already_imported: false });
    expect(db.listCompanies().map((company) => company.name)).toEqual(['Seed One', 'Seed Two']);
  });

  it('does not resurrect a deleted seed company on the next launch', () => {
    importSeedOnce(db, () => seedFile);
    const victim = db.listCompanies().find((company) => company.name === 'Seed One')!;
    db.deleteCompany(victim.id);
    expect(db.listCompanies().map((company) => company.name)).toEqual(['Seed Two']);

    // Two more launches, the second one being the case that used to bring it back.
    expect(importSeedOnce(db, () => seedFile)).toMatchObject({ inserted: 0, already_imported: true });
    expect(importSeedOnce(db, () => seedFile)).toMatchObject({ already_imported: true });
    expect(db.listCompanies().map((company) => company.name)).toEqual(['Seed Two']);
  });

  it('still re-adds the samples when the user explicitly asks for them', () => {
    importSeedOnce(db, () => seedFile);
    db.deleteCompany(db.listCompanies()[0].id);
    const forced = importSeedOnce(db, () => seedFile, true);
    expect(forced).toMatchObject({ inserted: 1, skipped: 1, already_imported: false });
    expect(db.listCompanies().map((company) => company.name)).toEqual(['Seed One', 'Seed Two']);
  });

  it('treats an upgraded database that already has companies as already seeded', () => {
    // A user on an older build has the seed rows and has deleted one. Upgrading must not undo that.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'board-tracker-upgrade-'));
    const file = path.join(directory, 'legacy.db');
    const legacy = new Database(file);
    legacy.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO schema_version(version) VALUES (1),(2); CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, business_summary TEXT, sector TEXT, website TEXT, board_size INTEGER, other_board_members TEXT, meeting_cadence TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE positions (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, status TEXT NOT NULL, position_type TEXT NOT NULL, start_date TEXT, end_date TEXT, expected_decision_date TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE instrument_types (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE compensation (id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', frequency TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO companies(id,name) VALUES (1,'Seed Two');");
    legacy.close();

    const upgraded = new BoardTrackerDatabase(file);
    expect(upgraded.hasImportedSeed()).toBe(true);
    expect(importSeedOnce(upgraded, () => seedFile)).toMatchObject({ already_imported: true });
    expect(upgraded.listCompanies().map((company) => company.name)).toEqual(['Seed Two']);
    upgraded.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('leaves an empty upgraded database free to seed', () => {
    expect(db.hasImportedSeed()).toBe(false);
  });

  it('stores and reads back arbitrary metadata', () => {
    expect(db.getMeta('nothing-here')).toBeNull();
    db.setMeta('greeting', 'hello');
    expect(db.getMeta('greeting')).toBe('hello');
    db.setMeta('greeting', 'goodbye');
    expect(db.getMeta('greeting')).toBe('goodbye');
  });
});

describe('deadline date arithmetic', () => {
  it('counts whole days between two dates, ignoring the clock', () => {
    expect(daysUntil('2026-08-09', '2026-08-09')).toBe(0);
    expect(daysUntil('2026-08-10', '2026-08-09')).toBe(1);
    expect(daysUntil('2026-08-08', '2026-08-09')).toBe(-1);
    expect(daysUntil('2026-09-08', '2026-08-09')).toBe(30);
  });

  it('does not drift across a daylight-saving boundary', () => {
    // 1 March to 1 April 2026 spans the US spring-forward; a naive hour count would give 30.96 days.
    expect(daysUntil('2026-04-01', '2026-03-01')).toBe(31);
    expect(daysUntil('2026-11-08', '2026-11-01')).toBe(7);
  });

  it('sorts dates into overdue, due soon, and upcoming', () => {
    expect(urgencyFor(-1, false)).toBe('overdue');
    expect(urgencyFor(0, false)).toBe('due_soon');
    expect(urgencyFor(DUE_SOON_DAYS, false)).toBe('due_soon');
    expect(urgencyFor(DUE_SOON_DAYS + 1, false)).toBe('upcoming');
    expect(urgencyFor(-40, true)).toBe('upcoming');
  });

  it('describes the wait in words', () => {
    expect(dueLabel(0, false)).toBe('Today');
    expect(dueLabel(1, false)).toBe('Tomorrow');
    expect(dueLabel(9, false)).toBe('In 9 days');
    expect(dueLabel(-1, false)).toBe('1 day overdue');
    expect(dueLabel(-4, false)).toBe('4 days overdue');
    expect(dueLabel(-4, true)).toBe('Done');
    expect(dueLabel(12, true)).toBe('Done');
  });
});

describe('which deadlines are worth showing', () => {
  const row = (overrides: Partial<DeadlineRow>): DeadlineRow => ({ id: null, source: 'tracked', title: 'Something', deadline_type: 'other', due_date: '2026-09-01', company_id: 1, company_name: 'Example Corp', position_id: null, detail: null, notes: null, completed_at: null, ...overrides });

  it('keeps a tracked deadline even long after it has passed', () => {
    const items = buildDeadlineItems([row({ id: 1, due_date: '2025-01-01' })], '2026-08-09');
    expect(items).toHaveLength(1);
    expect(items[0].urgency).toBe('overdue');
  });

  it('drops a derived date once it is in the past', () => {
    expect(buildDeadlineItems([row({ source: 'term_end', due_date: '2026-08-08' })], '2026-08-09')).toHaveLength(0);
    expect(buildDeadlineItems([row({ source: 'vesting_cliff', due_date: '2026-08-08' })], '2026-08-09')).toHaveLength(0);
  });

  it('keeps an overdue decision date, because a decision you are still waiting on still matters', () => {
    const items = buildDeadlineItems([row({ source: 'decision', due_date: '2026-07-01' })], '2026-08-09');
    expect(items).toHaveLength(1);
    expect(items[0].urgency).toBe('overdue');
  });

  it('orders by date and gives every row a stable unique key', () => {
    const items = buildDeadlineItems([
      row({ id: 3, due_date: '2026-12-01' }),
      row({ source: 'decision', due_date: '2026-08-20' }),
      row({ id: 1, due_date: '2026-08-10' }),
    ], '2026-08-09');
    expect(items.map((item) => item.due_date)).toEqual(['2026-08-10', '2026-08-20', '2026-12-01']);
    expect(new Set(items.map((item) => item.key)).size).toBe(3);
  });

  it('marks a completed deadline as done rather than overdue', () => {
    const rows = [row({ id: 1, due_date: '2026-01-01', completed_at: '2026-01-02T10:00:00Z' })];
    expect(buildDeadlineItems(rows, '2026-08-09')).toHaveLength(0);
    const items = buildDeadlineItems(rows, '2026-08-09', true);
    expect(items[0].completed_at).toBeTruthy();
    expect(items[0].urgency).not.toBe('overdue');
    expect(dueLabel(items[0].days_until, true)).toBe('Done');
  });
});

describe('deadline records', () => {
  const deadline = (overrides: Record<string, unknown> = {}) => ({ title: 'File Form D', deadline_type: 'filing' as const, due_date: '2026-09-01', company_id: null, position_id: null, notes: 'Within 15 days of first sale', ...overrides });

  it('creates, reads, updates, and deletes a deadline', () => {
    const created = db.createDeadline(deadline());
    expect(created.title).toBe('File Form D');
    expect(db.getDeadline(created.id)?.due_date).toBe('2026-09-01');

    db.updateDeadline(created.id, deadline({ title: 'File Form D (amended)', due_date: '2026-09-15' }));
    expect(db.getDeadline(created.id)).toMatchObject({ title: 'File Form D (amended)', due_date: '2026-09-15' });

    db.deleteDeadline(created.id);
    expect(db.getDeadline(created.id)).toBeUndefined();
  });

  it('marks a deadline done and reopens it', () => {
    const created = db.createDeadline(deadline());
    db.setDeadlineCompleted(created.id, true);
    expect(db.getDeadline(created.id)?.completed_at).toBeTruthy();
    db.setDeadlineCompleted(created.id, false);
    expect(db.getDeadline(created.id)?.completed_at).toBeNull();
  });

  it('hides completed deadlines unless they are asked for', () => {
    const created = db.createDeadline(deadline());
    db.setDeadlineCompleted(created.id, true);
    expect(db.listDeadlines({}, '2026-08-09')).toHaveLength(0);
    expect(db.listDeadlines({ include_completed: true }, '2026-08-09')).toHaveLength(1);
  });

  it('attaches a deadline to a company and reports its name', () => {
    const company = db.createCompany(companyInput());
    const created = db.createDeadline(deadline({ company_id: company.id }));
    const listed = db.listDeadlines({}, '2026-08-09').find((item) => item.id === created.id);
    expect(listed?.company_name).toBe('Example Corp');
  });

  it('deletes a company\u2019s deadlines along with the company', () => {
    const company = db.createCompany(companyInput());
    db.createDeadline(deadline({ company_id: company.id }));
    db.deleteCompany(company.id);
    expect(db.listDeadlines({ include_completed: true }, '2026-08-09')).toHaveLength(0);
  });

  it('keeps a deadline when the position it referenced goes away', () => {
    const company = db.createCompany(companyInput());
    const position = db.createPosition(positionInput(company.id));
    const created = db.createDeadline(deadline({ company_id: company.id, position_id: position.id }));
    db.deletePosition(position.id);
    expect(db.getDeadline(created.id)).toMatchObject({ id: created.id, position_id: null });
  });

  it('rejects a deadline with no title, no date, or an unknown type', () => {
    expect(() => db.createDeadline(deadline({ title: '   ' }))).toThrow();
    expect(() => db.createDeadline(deadline({ due_date: '' }))).toThrow();
    expect(() => db.createDeadline(deadline({ due_date: '01/09/2026' }))).toThrow();
    expect(() => db.createDeadline(deadline({ deadline_type: 'lunch' }))).toThrow();
  });
});

describe('deadlines derived from records you already keep', () => {
  it('surfaces the expected decision date of a potential position', () => {
    const company = db.createCompany(companyInput('Pipeline Co'));
    db.createPosition(positionInput(company.id, { status: 'potential', expected_decision_date: '2026-09-20' }));
    const items = db.listDeadlines({}, '2026-08-09');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'decision', due_date: '2026-09-20', company_name: 'Pipeline Co', id: null });
  });

  it('surfaces the end of a current term', () => {
    const company = db.createCompany(companyInput('Term Co'));
    db.createPosition(positionInput(company.id, { status: 'current', end_date: '2026-10-31' }));
    const items = db.listDeadlines({}, '2026-08-09');
    expect(items.map((item) => item.source)).toContain('term_end');
  });

  it('ignores the end date of a position that has already ended', () => {
    const company = db.createCompany(companyInput('Former Co'));
    db.createPosition(positionInput(company.id, { status: 'former', end_date: '2026-10-31' }));
    expect(db.listDeadlines({}, '2026-08-09')).toHaveLength(0);
  });

  it('surfaces an upcoming vesting cliff and the end of vesting', () => {
    const company = db.createCompany(companyInput('Equity Co'));
    const position = db.createPosition(positionInput(company.id));
    const type = db.listInstrumentTypes()[0];
    const compensation = db.createCompensation(nonCashInput(position.id, type.id));
    db.createVestingSchedule({ compensation_id: compensation.id, schedule_type: 'cliff_linear', vesting_start: '2026-01-01', cliff_date: '2026-11-01', vesting_end: '2029-01-01', duration_months: null, cadence: 'monthly', notes: null });
    const sources = db.listDeadlines({}, '2026-08-09').map((item) => item.source);
    expect(sources).toContain('vesting_cliff');
    expect(sources).toContain('vesting_end');
  });

  it('puts derived and tracked deadlines in one list, in date order', () => {
    const company = db.createCompany(companyInput('Mixed Co'));
    db.createPosition(positionInput(company.id, { status: 'potential', expected_decision_date: '2026-09-20' }));
    db.createDeadline({ title: 'Board pack review', deadline_type: 'review', due_date: '2026-08-25', company_id: company.id, position_id: null, notes: null });
    const items = db.listDeadlines({}, '2026-08-09');
    expect(items.map((item) => item.due_date)).toEqual(['2026-08-25', '2026-09-20']);
    expect(items.map((item) => item.source)).toEqual(['tracked', 'decision']);
  });

  it('feeds the dashboard with at most eight of the nearest deadlines', () => {
    const company = db.createCompany(companyInput('Busy Co'));
    for (let index = 1; index <= 10; index += 1) {
      db.createDeadline({ title: `Task ${index}`, deadline_type: 'other', due_date: `2026-09-${String(index).padStart(2, '0')}`, company_id: company.id, position_id: null, notes: null });
    }
    const dashboard = db.dashboard();
    expect(dashboard.deadlines).toHaveLength(8);
    expect(dashboard.deadlines[0].title).toBe('Task 1');
  });
});
