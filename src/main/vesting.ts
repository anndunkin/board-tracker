import type { VestingSchedule, VestingSummary } from '../shared/types';
const millisecondsPerDay = 86_400_000;
const utc = (value: string): number => Date.parse(`${value}T00:00:00Z`);

/**
 * Add whole months to a date, clamping to the last day of the target month rather than rolling into
 * the next one. A grant dated the 31st vesting over 48 months ends on the 31st where one exists and
 * on the 28th, 29th, or 30th where it does not — never on the 1st of the following month.
 */
export function addMonths(date: string, months: number): string | null {
  const time = utc(date);
  if (Number.isNaN(time) || !Number.isFinite(months)) return null;
  const start = new Date(time);
  const day = start.getUTCDate();
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return target.toISOString().slice(0, 10);
}

type EndInput = Pick<VestingSchedule, 'vesting_start' | 'vesting_end' | 'duration_months'>;

/**
 * The date this award finishes vesting, and whether that date was stated in the agreement or worked
 * out from the term. A stated end date always wins: if an agreement gives both an end date and a
 * month count that disagree, Board Tracker reports what the agreement says rather than its own
 * arithmetic.
 */
export function effectiveVestingEnd(schedule: EndInput): { date: string | null; derived: boolean } {
  if (schedule.vesting_end) return { date: schedule.vesting_end, derived: false };
  if (schedule.vesting_start && schedule.duration_months != null && schedule.duration_months > 0) {
    const date = addMonths(schedule.vesting_start, schedule.duration_months);
    if (date) return { date, derived: true };
  }
  return { date: null, derived: false };
}

export function calculateVestingSummary(schedule: Pick<VestingSchedule, 'schedule_type' | 'cliff_date' | 'vesting_start' | 'vesting_end' | 'duration_months'>, today = new Date().toISOString().slice(0, 10)): VestingSummary {
  if (schedule.schedule_type === 'immediate') return { kind: 'percentage', percentage: 100, text: '100% vested' };
  if (schedule.schedule_type === 'milestone' || schedule.schedule_type === 'custom') return { kind: 'not_calculable', text: 'Not calculable — see notes' };
  const end = effectiveVestingEnd(schedule);
  if (!schedule.cliff_date || !schedule.vesting_start || !end.date) return { kind: 'not_calculable', text: 'Not calculable — add an end date or a vesting term' };
  const todayTime = utc(today); const cliffTime = utc(schedule.cliff_date); const startTime = utc(schedule.vesting_start); const endTime = utc(end.date);
  if ([todayTime, cliffTime, startTime, endTime].some(Number.isNaN) || endTime <= startTime) return { kind: 'not_calculable', text: 'Not calculable — add an end date or a vesting term' };
  if (todayTime < cliffTime) return { kind: 'percentage', percentage: 0, text: '0% vested' };
  const percentage = Math.max(0, Math.min(100, ((todayTime - startTime) / (endTime - startTime)) * 100));
  const rounded = Math.round(percentage * 10) / 10;
  return { kind: 'percentage', percentage: rounded, text: `${rounded}% vested` };
}

/** Attach the worked-out end date to a schedule row so the interface can show it and say where it came from. */
export function withEffectiveEnd<T extends EndInput>(schedule: T): T & { effective_vesting_end: string | null; vesting_end_is_derived: boolean } {
  const end = effectiveVestingEnd(schedule);
  return { ...schedule, effective_vesting_end: end.date, vesting_end_is_derived: end.derived };
}

export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / millisecondsPerDay);
