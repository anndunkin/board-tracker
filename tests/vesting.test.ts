import { describe, expect, it } from 'vitest';
import { calculateVestingSummary } from '../src/main/vesting';
import type { VestingSchedule } from '../src/shared/types';
const cliffLinear = (overrides: Partial<VestingSchedule> = {}): VestingSchedule => ({ id: 1, compensation_id: 1, schedule_type: 'cliff_linear', vesting_start: '2026-01-01', cliff_date: '2026-01-01', vesting_end: '2026-01-11', cadence: 'monthly', notes: null, created_at: '', updated_at: '', ...overrides });
describe('vesting calculation', () => {
  it('is zero before and exactly at a later cliff, then interpolates linearly', () => { const schedule = cliffLinear({ cliff_date: '2026-01-03' }); expect(calculateVestingSummary(schedule, '2026-01-02')).toMatchObject({ percentage: 0 }); expect(calculateVestingSummary(schedule, '2026-01-03')).toMatchObject({ percentage: 20 }); expect(calculateVestingSummary(schedule, '2026-01-06')).toMatchObject({ percentage: 50 }); });
  it('caps cliff and linear schedules at zero and one hundred percent', () => { const schedule = cliffLinear(); expect(calculateVestingSummary(schedule, '2025-12-31')).toMatchObject({ percentage: 0 }); expect(calculateVestingSummary(schedule, '2026-01-11')).toMatchObject({ percentage: 100 }); expect(calculateVestingSummary(schedule, '2027-01-01')).toMatchObject({ percentage: 100 }); });
  it('reports immediate awards as fully vested', () => { expect(calculateVestingSummary(cliffLinear({ schedule_type: 'immediate', cliff_date: null, vesting_start: null, vesting_end: null }))).toEqual({ kind: 'percentage', percentage: 100, text: '100% vested' }); });
  it.each(['milestone', 'custom'] as const)('marks %s schedules as not calculable', (schedule_type) => { expect(calculateVestingSummary(cliffLinear({ schedule_type, cliff_date: null, vesting_start: null, vesting_end: null }))).toEqual({ kind: 'not_calculable', text: 'Not calculable — see notes' }); });
});
