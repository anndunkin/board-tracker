import type { VestingSchedule, VestingSummary } from '../shared/types';
const millisecondsPerDay = 86_400_000;
const utc = (value: string): number => Date.parse(`${value}T00:00:00Z`);
export function calculateVestingSummary(schedule: Pick<VestingSchedule, 'schedule_type' | 'cliff_date' | 'vesting_start' | 'vesting_end'>, today = new Date().toISOString().slice(0, 10)): VestingSummary {
  if (schedule.schedule_type === 'immediate') return { kind: 'percentage', percentage: 100, text: '100% vested' };
  if (schedule.schedule_type === 'milestone' || schedule.schedule_type === 'custom') return { kind: 'not_calculable', text: 'Not calculable — see notes' };
  if (!schedule.cliff_date || !schedule.vesting_start || !schedule.vesting_end) return { kind: 'not_calculable', text: 'Not calculable — complete schedule dates' };
  const todayTime = utc(today); const cliffTime = utc(schedule.cliff_date); const startTime = utc(schedule.vesting_start); const endTime = utc(schedule.vesting_end);
  if ([todayTime, cliffTime, startTime, endTime].some(Number.isNaN) || endTime <= startTime) return { kind: 'not_calculable', text: 'Not calculable — complete schedule dates' };
  if (todayTime < cliffTime) return { kind: 'percentage', percentage: 0, text: '0% vested' };
  const percentage = Math.max(0, Math.min(100, ((todayTime - startTime) / (endTime - startTime)) * 100));
  const rounded = Math.round(percentage * 10) / 10;
  return { kind: 'percentage', percentage: rounded, text: `${rounded}% vested` };
}
export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / millisecondsPerDay);
