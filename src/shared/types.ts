export type PositionStatus = 'current' | 'former' | 'potential';
export type PositionType = 'governing_board' | 'advisory_board' | 'advisor';
export type CompensationType = 'cash' | 'non_cash';
export type CompensationFrequency = 'one_time' | 'annual' | 'quarterly' | 'monthly' | 'per_meeting';
export type VestingScheduleType = 'immediate' | 'cliff_linear' | 'milestone' | 'custom';
export type VestingCadence = 'monthly' | 'quarterly' | 'annual' | 'one_time';
export type DocumentStatus = 'linked' | 'missing';

export interface CompanyInput { name: string; business_summary?: string | null; sector?: string | null; website?: string | null; board_size?: number | null; other_board_members?: string | null; meeting_cadence?: string | null; notes?: string | null; }
export interface Company extends Required<Omit<CompanyInput, 'board_size'>> { id: number; board_size: number | null; created_at: string; updated_at: string; position_count?: number; }

export interface PositionInput { company_id: number; status: PositionStatus; position_type: PositionType; start_date?: string | null; end_date?: string | null; expected_decision_date?: string | null; notes?: string | null; }
export interface Position extends Omit<PositionInput, 'start_date' | 'end_date' | 'expected_decision_date' | 'notes'> { id: number; start_date: string | null; end_date: string | null; expected_decision_date: string | null; notes: string | null; created_at: string; updated_at: string; }

export interface InstrumentTypeInput { name: string; description?: string | null; }
export interface InstrumentType extends Required<InstrumentTypeInput> { id: number; created_at: string; }

export interface CompensationInput { position_id: number; type?: CompensationType; amount?: number | null; currency?: string | null; frequency?: CompensationFrequency | null; instrument_type_id?: number | null; quantity?: number | null; grant_price?: number | null; grant_date?: string | null; notes?: string | null; }
export interface Compensation { id: number; position_id: number; type: CompensationType; amount: number | null; currency: string | null; frequency: CompensationFrequency | null; instrument_type_id: number | null; instrument_type_name?: string | null; quantity: number | null; grant_price: number | null; grant_date: string | null; notes: string | null; created_at: string; updated_at: string; active_vesting_schedule?: VestingSchedule | null; vesting_summary?: VestingSummary; }

export interface VestingScheduleInput { compensation_id: number; schedule_type: VestingScheduleType; cliff_date?: string | null; vesting_start?: string | null; vesting_end?: string | null; cadence?: VestingCadence | null; notes?: string | null; }
export interface VestingSchedule extends Omit<VestingScheduleInput, 'cliff_date' | 'vesting_start' | 'vesting_end' | 'cadence' | 'notes'> { id: number; cliff_date: string | null; vesting_start: string | null; vesting_end: string | null; cadence: VestingCadence | null; notes: string | null; created_at: string; updated_at: string; }

export interface VestingSummary { kind: 'percentage' | 'not_calculable'; percentage?: number; text: string; }
export interface DocumentInput { company_id: number; position_id?: number | null; compensation_id?: number | null; document_type: string; file_path?: string | null; file_name?: string | null; description?: string | null; document_date?: string | null; status: DocumentStatus; }
export interface Document extends Omit<DocumentInput, 'position_id' | 'compensation_id' | 'file_path' | 'file_name' | 'description' | 'document_date'> { id: number; position_id: number | null; compensation_id: number | null; file_path: string | null; file_name: string | null; description: string | null; document_date: string | null; created_at: string; updated_at: string; position_status?: PositionStatus | null; position_type?: PositionType | null; compensation_type?: CompensationType | null; compensation_quantity?: number | null; instrument_type_name?: string | null; }
export interface CompanyDetail extends Company { positions: Array<Position & { compensation: Compensation[] }>; documents: Document[]; }
export interface UpcomingVesting extends VestingSchedule { company_id: number; company_name: string; position_id: number; quantity: number | null; instrument_type_name: string | null; vesting_summary: VestingSummary; }
export interface MissingDocument extends Document { company_name: string; }
export interface DashboardData { counts: Record<PositionStatus, number>; upcoming: Array<Position & { company_name: string }>; upcoming_vesting: UpcomingVesting[]; missing_documents: MissingDocument[]; }
export interface DocumentOpenResult { ok: boolean; error?: string; }

export interface BoardTrackerApi {
  dashboard: () => Promise<DashboardData>;
  companies: { list: (search?: string) => Promise<Company[]>; get: (id: number) => Promise<CompanyDetail | null>; create: (input: CompanyInput) => Promise<Company>; update: (id: number, input: CompanyInput) => Promise<Company>; delete: (id: number) => Promise<void>; };
  positions: { create: (input: PositionInput) => Promise<Position>; update: (id: number, input: PositionInput) => Promise<Position>; delete: (id: number) => Promise<void>; };
  compensation: { create: (input: CompensationInput) => Promise<Compensation>; update: (id: number, input: CompensationInput) => Promise<Compensation>; delete: (id: number) => Promise<void>; };
  instrumentTypes: { list: () => Promise<InstrumentType[]>; create: (input: InstrumentTypeInput) => Promise<InstrumentType>; update: (id: number, input: InstrumentTypeInput) => Promise<InstrumentType>; delete: (id: number) => Promise<void>; };
  vestingSchedules: { create: (input: VestingScheduleInput) => Promise<VestingSchedule>; update: (id: number, input: VestingScheduleInput) => Promise<VestingSchedule>; delete: (id: number) => Promise<void>; };
  documents: { create: (input: DocumentInput) => Promise<Document>; update: (id: number, input: DocumentInput) => Promise<Document>; delete: (id: number) => Promise<void>; pickFile: () => Promise<string | null>; open: (filePath: string) => Promise<DocumentOpenResult>; };
  importSeedData: () => Promise<{ inserted: number; skipped: number }>;
}
