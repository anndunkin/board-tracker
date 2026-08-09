import type { CompensationFrequency, CompensationType, DocumentStatus, PositionStatus, PositionType, VestingCadence, VestingScheduleType } from './types';

/**
 * The single source of truth for every enumerated import value. The runtime parser and the
 * published JSON Schema both read these, so the two can never disagree about what is legal.
 */
/** Identity of the import format. Shared so the renderer and prompts can name it without
 * reaching into main-process code. */
export const IMPORT_SCHEMA_ID = 'board-tracker.import';
export const IMPORT_SCHEMA_VERSION = 1;

export const positionStatuses: PositionStatus[] = ['current', 'former', 'potential'];
export const positionTypes: PositionType[] = ['governing_board', 'advisory_board', 'advisor'];
export const compensationTypes: CompensationType[] = ['cash', 'non_cash'];
export const frequencies: CompensationFrequency[] = ['one_time', 'annual', 'quarterly', 'monthly', 'per_meeting'];
export const scheduleTypes: VestingScheduleType[] = ['immediate', 'cliff_linear', 'milestone', 'custom'];
export const cadences: VestingCadence[] = ['monthly', 'quarterly', 'annual', 'one_time'];
export const documentStatuses: DocumentStatus[] = ['linked', 'missing'];
