import type { DeadlineItem, DeadlineSource, DeadlineUrgency } from './types';

/** Anything falling due inside this window is called out rather than left in the general list. */
export const DUE_SOON_DAYS = 30;

export const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Whole days from one calendar date to another. Both are plain YYYY-MM-DD, so this is deliberately
 * done in UTC: a deadline is a date on a calendar, not an instant, and must not shift with the
 * clocks or with the machine's timezone.
 */
export function daysUntil(dueDate: string, from: string): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const start = Date.parse(`${from}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(start)) return 0;
  return Math.round((due - start) / 86_400_000);
}

export function urgencyFor(days: number, completed: boolean): DeadlineUrgency {
  if (completed) return 'upcoming';
  if (days < 0) return 'overdue';
  return days <= DUE_SOON_DAYS ? 'due_soon' : 'upcoming';
}

/** Plain-language due text. Used in the list and the dashboard so both read the same way. */
export function dueLabel(days: number, completed: boolean): string {
  if (completed) return 'Done';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days < 45) return `In ${days} days`;
  const months = Math.round(days / 30);
  return months < 24 ? `In about ${months} months` : `In about ${Math.round(days / 365)} years`;
}

export interface DeadlineRow {
  source: DeadlineSource;
  id: number | null;
  title: string;
  detail: string | null;
  due_date: string | null;
  company_id: number | null;
  company_name: string | null;
  position_id: number | null;
  deadline_type: DeadlineItem['deadline_type'];
  notes: string | null;
  completed_at: string | null;
}

/**
 * Merges what you entered with what the records already imply, into one ordered list.
 *
 * Derived entries are only worth showing while they are still ahead of you, with one exception: an
 * expected decision date that has passed on a position still marked potential is precisely the
 * thing you would want chased, so those are kept. Entries you tracked yourself are always kept,
 * overdue or not — hiding them would defeat the point.
 */
export function buildDeadlineItems(rows: DeadlineRow[], asOf = today(), includeCompleted = false): DeadlineItem[] {
  const items: DeadlineItem[] = [];
  for (const row of rows) {
    if (!row.due_date) continue;
    const completed = Boolean(row.completed_at);
    if (completed && !includeCompleted) continue;
    const days = daysUntil(row.due_date, asOf);
    const keepDerived = row.source === 'tracked' || days >= 0 || row.source === 'decision';
    if (!keepDerived) continue;
    items.push({
      key: row.source === 'tracked' ? `tracked:${row.id}` : `${row.source}:${row.position_id ?? row.company_id ?? 0}:${row.due_date}`,
      source: row.source, id: row.id, title: row.title, detail: row.detail, due_date: row.due_date,
      company_id: row.company_id, company_name: row.company_name, position_id: row.position_id,
      deadline_type: row.deadline_type, notes: row.notes, completed_at: row.completed_at,
      days_until: days, urgency: urgencyFor(days, completed),
    });
  }
  // Outstanding first, soonest first, then completed ones at the end in the order they fell due.
  return items.sort((a, b) => {
    const done = Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at));
    if (done) return done;
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return (a.company_name ?? '').localeCompare(b.company_name ?? '') || a.title.localeCompare(b.title);
  });
}
