import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { companyInput, nonCashInput, positionInput, testDatabase } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
import { addMonths, calculateVestingSummary, effectiveVestingEnd } from '../src/main/vesting';
import type { VestingSchedule } from '../src/shared/types';
const cliffLinear = (overrides: Partial<VestingSchedule> = {}): VestingSchedule => ({ id: 1, compensation_id: 1, schedule_type: 'cliff_linear', vesting_start: '2026-01-01', cliff_date: '2026-01-01', vesting_end: '2026-01-11', duration_months: null, cadence: 'monthly', notes: null, created_at: '', updated_at: '', ...overrides });
describe('vesting calculation', () => {
  it('is zero before and exactly at a later cliff, then interpolates linearly', () => { const schedule = cliffLinear({ cliff_date: '2026-01-03' }); expect(calculateVestingSummary(schedule, '2026-01-02')).toMatchObject({ percentage: 0 }); expect(calculateVestingSummary(schedule, '2026-01-03')).toMatchObject({ percentage: 20 }); expect(calculateVestingSummary(schedule, '2026-01-06')).toMatchObject({ percentage: 50 }); });
  it('caps cliff and linear schedules at zero and one hundred percent', () => { const schedule = cliffLinear(); expect(calculateVestingSummary(schedule, '2025-12-31')).toMatchObject({ percentage: 0 }); expect(calculateVestingSummary(schedule, '2026-01-11')).toMatchObject({ percentage: 100 }); expect(calculateVestingSummary(schedule, '2027-01-01')).toMatchObject({ percentage: 100 }); });
  it('reports immediate awards as fully vested', () => { expect(calculateVestingSummary(cliffLinear({ schedule_type: 'immediate', cliff_date: null, vesting_start: null, vesting_end: null }))).toEqual({ kind: 'percentage', percentage: 100, text: '100% vested' }); });
  it.each(['milestone', 'custom'] as const)('marks %s schedules as not calculable', (schedule_type) => { expect(calculateVestingSummary(cliffLinear({ schedule_type, cliff_date: null, vesting_start: null, vesting_end: null }))).toEqual({ kind: 'not_calculable', text: 'Not calculable — see notes' }); });
});

describe('vesting term: agreements that state a duration instead of an end date', () => {
  it('adds whole months without rolling into the next one', () => {
    expect(addMonths('2026-03-09', 48)).toBe('2030-03-09');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-12-15', 3)).toBe('2027-03-15');
  });

  it('works out the end date from the term when none is stated', () => {
    expect(effectiveVestingEnd({ vesting_start: '2026-03-09', vesting_end: null, duration_months: 48 })).toEqual({ date: '2030-03-09', derived: true });
  });

  it('prefers a stated end date over the term, and says the date was not derived', () => {
    // If the agreement contradicts itself, report what it says rather than our own arithmetic.
    expect(effectiveVestingEnd({ vesting_start: '2026-03-09', vesting_end: '2029-01-01', duration_months: 48 })).toEqual({ date: '2029-01-01', derived: false });
  });

  it('has nothing to work out when neither is given', () => {
    expect(effectiveVestingEnd({ vesting_start: '2026-03-09', vesting_end: null, duration_months: null })).toEqual({ date: null, derived: false });
    expect(effectiveVestingEnd({ vesting_start: null, vesting_end: null, duration_months: 48 })).toEqual({ date: null, derived: false });
  });

  it('computes percent vested from the term', () => {
    const schedule = cliffLinear({ vesting_start: '2026-03-09', cliff_date: '2027-03-09', vesting_end: null, duration_months: 48 });
    expect(calculateVestingSummary(schedule, '2027-03-09')).toMatchObject({ kind: 'percentage', percentage: 25 });
    expect(calculateVestingSummary(schedule, '2030-03-09')).toMatchObject({ percentage: 100 });
    expect(calculateVestingSummary(schedule, '2026-06-01')).toMatchObject({ percentage: 0 });
  });

  it('still refuses to guess when there is neither an end date nor a term', () => {
    expect(calculateVestingSummary(cliffLinear({ vesting_end: null, duration_months: null })))
      .toEqual({ kind: 'not_calculable', text: 'Not calculable — add an end date or a vesting term' });
  });
});

describe('vesting term: what the database accepts and gives back', () => {
  let db: BoardTrackerDatabase; let cleanup: () => void;
  beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());

  const grant = () => {
    const company = db.createCompany(companyInput('AutoBridge Systems'));
    const position = db.createPosition(positionInput(company.id));
    const instrument = db.listInstrumentTypes()[0];
    return { company, compensation: db.createCompensation(nonCashInput(position.id, instrument.id)) };
  };

  it('stores a term with no end date and reports the worked-out end', () => {
    const { company, compensation } = grant();
    db.createVestingSchedule({ compensation_id: compensation.id, schedule_type: 'cliff_linear', vesting_start: '2026-03-09', cliff_date: '2027-03-09', vesting_end: null, duration_months: 48, cadence: 'monthly' });
    const saved = db.getCompany(company.id)!.positions[0].compensation[0].active_vesting_schedule!;
    expect(saved).toMatchObject({ duration_months: 48, vesting_end: null, effective_vesting_end: '2030-03-09', vesting_end_is_derived: true });
  });

  it('marks a stated end date as stated even when a term is also recorded', () => {
    const { company, compensation } = grant();
    db.createVestingSchedule({ compensation_id: compensation.id, schedule_type: 'cliff_linear', vesting_start: '2026-03-09', cliff_date: '2027-03-09', vesting_end: '2030-03-09', duration_months: 48, cadence: 'monthly' });
    expect(db.getCompany(company.id)!.positions[0].compensation[0].active_vesting_schedule).toMatchObject({ vesting_end_is_derived: false, effective_vesting_end: '2030-03-09' });
  });

  it('requires one of an end date or a term, and rejects a nonsense term', () => {
    const { compensation } = grant();
    const base = { compensation_id: compensation.id, schedule_type: 'cliff_linear' as const, vesting_start: '2026-03-09', cliff_date: '2027-03-09', cadence: 'monthly' as const };
    expect(() => db.createVestingSchedule({ ...base, vesting_end: null, duration_months: null })).toThrow(/end date or a vesting term/);
    expect(() => db.createVestingSchedule({ ...base, vesting_end: null, duration_months: 0 })).toThrow(/between 1 and 600/);
    expect(() => db.createVestingSchedule({ ...base, vesting_end: null, duration_months: 4.5 })).toThrow(/whole number/);
    expect(() => db.createVestingSchedule({ ...base, vesting_end: null, duration_months: 'soon' })).toThrow(/number of months/);
  });

  it('rejects a cliff that falls after the end the term implies', () => {
    const { compensation } = grant();
    expect(() => db.createVestingSchedule({ compensation_id: compensation.id, schedule_type: 'cliff_linear', vesting_start: '2026-03-09', cliff_date: '2029-03-09', vesting_end: null, duration_months: 12 })).toThrow(/ordered start, cliff, then end/);
  });
});
