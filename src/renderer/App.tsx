import { FormEvent, useEffect, useState } from 'react';
import type { Company, CompanyDetail, CompanyInput, Compensation, CompensationFrequency, CompensationInput, CompensationType, DashboardData, InstrumentType, InstrumentTypeInput, Position, PositionInput, PositionStatus, PositionType, VestingCadence, VestingSchedule, VestingScheduleInput, VestingScheduleType } from '../shared/types';

type Modal = null | { kind: 'company'; item?: Company } | { kind: 'position'; item?: Position } | { kind: 'compensation'; positionId: number; item?: Compensation } | { kind: 'instrument-type'; item?: InstrumentType };
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const date = (value: string | null | undefined) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
const money = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
const quantity = (value: number | null) => value == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);

function App() {
  const [view, setView] = useState<'dashboard' | 'companies' | 'instrument-types'>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [instrumentTypes, setInstrumentTypes] = useState<InstrumentType[]>([]);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const refreshDashboard = () => window.boardTracker.dashboard().then(setDashboard);
  const refreshCompanies = () => window.boardTracker.companies.list(search).then(setCompanies);
  const refreshInstrumentTypes = () => window.boardTracker.instrumentTypes.list().then(setInstrumentTypes);
  const refreshDetail = (id: number) => window.boardTracker.companies.get(id).then(setDetail);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { refreshDashboard(); refreshInstrumentTypes(); }, []);
  useEffect(() => { const timer = window.setTimeout(refreshCompanies, 120); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    const seeded = () => { refreshDashboard(); refreshCompanies(); refreshInstrumentTypes(); if (detail) refreshDetail(detail.id); setMessage('Seed data import completed.'); };
    const changed = () => { refreshDashboard(); refreshCompanies(); refreshInstrumentTypes(); if (detail) refreshDetail(detail.id); };
    window.addEventListener('seed-imported', seeded); window.addEventListener('records-changed', changed);
    return () => { window.removeEventListener('seed-imported', seeded); window.removeEventListener('records-changed', changed); };
  }, [detail]);

  const openCompany = (id: number) => { refreshDetail(id); setView('companies'); };
  const openInstrumentTypes = () => { setDetail(null); setView('instrument-types'); };
  const mutate = async (work: () => Promise<unknown>, success: string) => { try { await work(); setModal(null); setMessage(success); refreshDashboard(); refreshCompanies(); refreshInstrumentTypes(); if (detail) refreshDetail(detail.id); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const importSeed = () => mutate(() => window.boardTracker.importSeedData(), 'Seed data imported (existing company names were skipped).');

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">BT</span><span>Board<br />Tracker</span></div>
      <nav>
        <button className={view === 'dashboard' ? 'nav active' : 'nav'} onClick={() => { setDetail(null); setView('dashboard'); }}>Overview</button>
        <button className={view === 'companies' ? 'nav active' : 'nav'} onClick={() => { setDetail(null); setView('companies'); }}>Companies</button>
        <button className={view === 'instrument-types' ? 'nav active' : 'nav'} onClick={openInstrumentTypes}>Instrument types</button>
      </nav>
      <div className="side-bottom"><button className="nav" onClick={importSeed}>Import seed data</button><button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color theme">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button></div>
    </aside>
    <main className="main">
      {message && <div className="toast" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss">×</button></div>}
      {detail ? <CompanyDetailPage detail={detail} back={() => setDetail(null)} openModal={setModal} onDelete={() => { if (window.confirm(`Delete ${detail.name}? Its ${detail.positions.length} position(s), compensation, and vesting schedules will also be deleted.`)) void mutate(() => window.boardTracker.companies.delete(detail.id), 'Company and related records deleted.').then(() => setDetail(null)); }} /> : view === 'dashboard' ? <Dashboard data={dashboard} showCompanies={() => setView('companies')} openCompany={openCompany} /> : view === 'companies' ? <Companies companies={companies} search={search} setSearch={setSearch} openCompany={openCompany} add={() => setModal({ kind: 'company' })} /> : <InstrumentTypes types={instrumentTypes} add={() => setModal({ kind: 'instrument-type' })} edit={(item) => setModal({ kind: 'instrument-type', item })} remove={(item) => { if (window.confirm(`Delete ${item.name}? This type cannot be deleted if it is in use by a non-cash compensation record.`)) void mutate(() => window.boardTracker.instrumentTypes.delete(item.id), 'Instrument type deleted.'); }} />}
    </main>
    {modal && <ModalForm modal={modal} detail={detail} instrumentTypes={instrumentTypes} close={() => setModal(null)} openInstrumentTypes={openInstrumentTypes} submit={mutate} />}
  </div>;
}

function Dashboard({ data, showCompanies, openCompany }: { data: DashboardData | null; showCompanies: () => void; openCompany: (id: number) => void }) {
  return <>
    <header className="page-header"><div><p className="eyebrow">Board position portfolio</p><h1>Overview</h1></div><button className="button secondary" onClick={showCompanies}>Manage companies</button></header>
    <section className="metric-grid">{(['current', 'former', 'potential'] as PositionStatus[]).map((status) => <article className={`metric ${status}`} key={status}><span>{label(status)} positions</span><strong>{data?.counts[status] ?? 0}</strong></article>)}</section>
    <section className="content-card dashboard-card"><div className="section-heading"><div><p className="eyebrow">Pipeline</p><h2>Upcoming decisions</h2></div></div>{data?.upcoming.length ? <div className="upcoming-list">{data.upcoming.map((position) => <button key={position.id} className="upcoming-row" onClick={() => openCompany(position.company_id)}><span><strong>{position.company_name}</strong><small>{label(position.position_type)}</small></span><time>{date(position.expected_decision_date)}</time></button>)}</div> : <Empty title="No upcoming decisions" text="Potential positions with a decision date will appear here." />}</section>
    <section className="content-card dashboard-card"><div className="section-heading"><div><p className="eyebrow">Equity</p><h2>Upcoming vesting</h2></div></div>{data?.upcoming_vesting.length ? <div className="upcoming-list">{data.upcoming_vesting.map((schedule) => <button key={schedule.id} className="upcoming-row" onClick={() => openCompany(schedule.company_id)}><span><strong>{schedule.company_name}</strong><small>{quantity(schedule.quantity)} {schedule.instrument_type_name || 'instrument'} · {schedule.vesting_summary.text}</small></span><time>Ends {date(schedule.vesting_end)}</time></button>)}</div> : <Empty title="No active vesting" text="Cliff and linear awards that are currently vesting will appear here." />}</section>
  </>;
}

function Companies({ companies, search, setSearch, openCompany, add }: { companies: Company[]; search: string; setSearch: (value: string) => void; openCompany: (id: number) => void; add: () => void }) {
  return <><header className="page-header"><div><p className="eyebrow">Directory</p><h1>Companies</h1></div><button className="button" onClick={add}>Add company</button></header><section className="content-card table-card"><div className="toolbar"><input aria-label="Search companies" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by company name" /><span>{companies.length} total</span></div>{companies.length ? <table><thead><tr><th>Company</th><th>Sector</th><th>Positions</th></tr></thead><tbody>{companies.map((company) => <tr key={company.id} tabIndex={0} onClick={() => openCompany(company.id)} onKeyDown={(event) => event.key === 'Enter' && openCompany(company.id)}><td><strong>{company.name}</strong></td><td>{company.sector || '—'}</td><td>{company.position_count ?? 0}</td></tr>)}</tbody></table> : <Empty title="No companies found" text="Add a company or import the seed data to begin." />}</section></>;
}

function InstrumentTypes({ types, add, edit, remove }: { types: InstrumentType[]; add: () => void; edit: (item: InstrumentType) => void; remove: (item: InstrumentType) => void }) {
  return <><header className="page-header"><div><p className="eyebrow">Settings</p><h1>Instrument types</h1><p className="lede">Manage the equity and non-cash award types available in compensation records.</p></div><button className="button" onClick={add}>Add type</button></header><section className="content-card table-card">{types.length ? <table><thead><tr><th>Name</th><th>Description</th><th aria-label="Actions" /></tr></thead><tbody>{types.map((item) => <tr className="static-row" key={item.id}><td><strong>{item.name}</strong></td><td>{item.description || '—'}</td><td className="row-actions"><button onClick={() => edit(item)}>Edit</button><button className="text-danger" onClick={() => remove(item)}>Delete</button></td></tr>)}</tbody></table> : <Empty title="No instrument types" text="Add an award type to use it in non-cash compensation." />}</section></>;
}

function CompanyDetailPage({ detail, back, openModal, onDelete }: { detail: CompanyDetail; back: () => void; openModal: (modal: Modal) => void; onDelete: () => void }) {
  const field = (name: string, value: string | number | null | undefined) => value != null && value !== '' ? <div className="detail-field"><dt>{name}</dt><dd>{value}</dd></div> : null;
  return <>
    <header className="page-header detail-header"><div><button className="back" onClick={back}>← Companies</button><p className="eyebrow">Company record</p><h1>{detail.name}</h1><p className="lede">{detail.sector || 'No sector entered'}</p></div><div className="header-actions"><button className="button secondary" onClick={() => openModal({ kind: 'company', item: detail })}>Edit company</button><button className="button danger" onClick={onDelete}>Delete</button></div></header>
    <section className="company-info content-card"><dl>{field('Business summary', detail.business_summary)}{field('Website', detail.website)}{field('Board size', detail.board_size)}{field('Other board members', detail.other_board_members)}{field('Meeting cadence', detail.meeting_cadence)}{field('Notes', detail.notes)}</dl></section>
    <section className="positions-section"><div className="section-heading"><div><p className="eyebrow">Appointments</p><h2>Positions</h2></div><button className="button" onClick={() => openModal({ kind: 'position' })}>Add position</button></div>{detail.positions.length ? <div className="position-list">{detail.positions.map((position) => <article className="position-card" key={position.id}><div className="position-title"><div><span className={`badge ${position.status}`}>{position.status}</span><h3>{label(position.position_type)}</h3><p>{position.start_date ? `${date(position.start_date)}${position.end_date ? ` – ${date(position.end_date)}` : ''}` : 'Dates not entered'}{position.status === 'potential' && ` · Decision: ${date(position.expected_decision_date)}`}</p></div><div className="compact-actions"><button onClick={() => openModal({ kind: 'position', item: position })}>Edit</button><button className="text-danger" onClick={() => { if (window.confirm('Delete this position, its compensation, and vesting schedules?')) void window.boardTracker.positions.delete(position.id).then(() => window.dispatchEvent(new Event('records-changed'))); }}>Delete</button></div></div>{position.notes && <p className="position-notes">{position.notes}</p>}<div className="comp-heading"><h4>Compensation</h4><button onClick={() => openModal({ kind: 'compensation', positionId: position.id })}>Add compensation</button></div>{position.compensation.length ? <div className="comp-list">{position.compensation.map((compensation) => <CompensationRow key={compensation.id} compensation={compensation} edit={() => openModal({ kind: 'compensation', positionId: position.id, item: compensation })} remove={() => { if (window.confirm('Delete this compensation entry and any vesting schedules?')) void window.boardTracker.compensation.delete(compensation.id).then(() => window.dispatchEvent(new Event('records-changed'))); }} />)}</div> : <p className="muted">No compensation entered.</p>}</article>)}</div> : <Empty title="No positions yet" text="Add a current, former, or potential position for this company." />}</section>
  </>;
}

function CompensationRow({ compensation, edit, remove }: { compensation: Compensation; edit: () => void; remove: () => void }) {
  const nonCash = compensation.type === 'non_cash';
  return <div className="comp-row"><span><strong>{nonCash ? `${quantity(compensation.quantity)} ${compensation.instrument_type_name || 'instrument units'}` : money(compensation.amount ?? 0, compensation.currency || 'USD')}</strong><small>{nonCash ? `${compensation.grant_price == null ? 'No grant price' : `${money(compensation.grant_price, 'USD')} per unit`}${compensation.grant_date ? ` · Granted ${date(compensation.grant_date)}` : ''}` : label(compensation.frequency || 'one_time')}{compensation.notes ? ` · ${compensation.notes}` : ''}</small>{nonCash && <small className="vesting-line">Vesting: {compensation.vesting_summary?.text || 'No vesting schedule'}</small>}</span><div className="compact-actions"><button onClick={edit}>Edit</button><button className="text-danger" onClick={remove}>Delete</button></div></div>;
}

function ModalForm({ modal, detail, instrumentTypes, close, openInstrumentTypes, submit }: { modal: Exclude<Modal, null>; detail: CompanyDetail | null; instrumentTypes: InstrumentType[]; close: () => void; openInstrumentTypes: () => void; submit: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const company = modal.kind === 'company' ? modal.item : undefined;
  const position = modal.kind === 'position' ? modal.item : undefined;
  const compensation = modal.kind === 'compensation' ? modal.item : undefined;
  const instrumentType = modal.kind === 'instrument-type' ? modal.item : undefined;
  const schedule = compensation?.active_vesting_schedule;
  const [status, setStatus] = useState<PositionStatus>(position?.status ?? 'current');
  const [compensationType, setCompensationType] = useState<CompensationType>(compensation?.type ?? 'cash');
  const [hasVesting, setHasVesting] = useState(Boolean(schedule));
  const [scheduleType, setScheduleType] = useState<VestingScheduleType>(schedule?.schedule_type ?? 'immediate');
  const [error, setError] = useState('');
  const heading = modal.kind === 'company' ? `${company ? 'Edit' : 'Add'} company` : modal.kind === 'position' ? `${position ? 'Edit' : 'Add'} position` : modal.kind === 'instrument-type' ? `${instrumentType ? 'Edit' : 'Add'} instrument type` : `${compensation ? 'Edit' : 'Add'} compensation`;
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); const form = new FormData(event.currentTarget);
    try {
      if (modal.kind === 'company') {
        const input: CompanyInput = { name: String(form.get('name') || ''), business_summary: String(form.get('business_summary') || ''), sector: String(form.get('sector') || ''), website: String(form.get('website') || ''), board_size: form.get('board_size') ? Number(form.get('board_size')) : null, other_board_members: String(form.get('other_board_members') || ''), meeting_cadence: String(form.get('meeting_cadence') || ''), notes: String(form.get('notes') || '') };
        void submit(() => company ? window.boardTracker.companies.update(company.id, input) : window.boardTracker.companies.create(input), 'Company saved.');
      } else if (modal.kind === 'position' && detail) {
        const input: PositionInput = { company_id: detail.id, status, position_type: String(form.get('position_type')) as PositionType, start_date: String(form.get('start_date') || ''), end_date: String(form.get('end_date') || ''), expected_decision_date: status === 'potential' ? String(form.get('expected_decision_date') || '') : null, notes: String(form.get('notes') || '') };
        void submit(() => position ? window.boardTracker.positions.update(position.id, input) : window.boardTracker.positions.create(input), 'Position saved.');
      } else if (modal.kind === 'instrument-type') {
        const input: InstrumentTypeInput = { name: String(form.get('name') || ''), description: String(form.get('description') || '') };
        void submit(() => instrumentType ? window.boardTracker.instrumentTypes.update(instrumentType.id, input) : window.boardTracker.instrumentTypes.create(input), 'Instrument type saved.');
      } else if (modal.kind === 'compensation') {
        const input: CompensationInput = compensationType === 'cash' ? { position_id: modal.positionId, type: 'cash', amount: Number(form.get('amount')), currency: String(form.get('currency') || 'USD'), frequency: String(form.get('frequency')) as CompensationFrequency, notes: String(form.get('notes') || '') } : { position_id: modal.positionId, type: 'non_cash', instrument_type_id: Number(form.get('instrument_type_id')), quantity: Number(form.get('quantity')), grant_price: form.get('grant_price') ? Number(form.get('grant_price')) : null, grant_date: String(form.get('grant_date') || ''), notes: String(form.get('notes') || '') };
        const vestingInput = (): Omit<VestingScheduleInput, 'compensation_id'> => ({ schedule_type: scheduleType, cliff_date: String(form.get('cliff_date') || ''), vesting_start: String(form.get('vesting_start') || ''), vesting_end: String(form.get('vesting_end') || ''), cadence: String(form.get('cadence') || '') as VestingCadence, notes: String(form.get('vesting_notes') || '') });
        void submit(async () => {
          const saved = compensation ? await window.boardTracker.compensation.update(compensation.id, input) : await window.boardTracker.compensation.create(input);
          if (compensationType === 'non_cash' && hasVesting) { const scheduleData = { compensation_id: saved.id, ...vestingInput() }; if (schedule) await window.boardTracker.vestingSchedules.update(schedule.id, scheduleData); else await window.boardTracker.vestingSchedules.create(scheduleData); }
          else if (schedule) await window.boardTracker.vestingSchedules.delete(schedule.id);
          return saved;
        }, `${compensationType === 'cash' ? 'Cash' : 'Non-cash'} compensation saved.`);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{heading}</h2><button onClick={close} aria-label="Close dialog">×</button></div><form onSubmit={onSubmit}>
    {modal.kind === 'company' && <><Field label="Company name" name="name" required defaultValue={company?.name} /><Field label="Sector" name="sector" defaultValue={company?.sector} /><Field label="Website" name="website" defaultValue={company?.website} /><Field label="Board size" name="board_size" type="number" min="0" defaultValue={company?.board_size ?? ''} /><Field label="Business summary" name="business_summary" area defaultValue={company?.business_summary} /><Field label="Other board members" name="other_board_members" area defaultValue={company?.other_board_members} /><Field label="Meeting cadence" name="meeting_cadence" defaultValue={company?.meeting_cadence} /><Field label="Notes" name="notes" area defaultValue={company?.notes} /></>}
    {modal.kind === 'position' && <><p className="form-context">Company: <strong>{detail?.name}</strong></p><label>Status<select name="status" value={status} onChange={(event) => setStatus(event.target.value as PositionStatus)}><option value="current">Current</option><option value="former">Former</option><option value="potential">Potential</option></select></label><label>Position type<select name="position_type" defaultValue={position?.position_type ?? 'governing_board'}><option value="governing_board">Governing board</option><option value="advisory_board">Advisory board</option><option value="advisor">Advisor</option></select></label><Field label="Start date" name="start_date" type="date" defaultValue={position?.start_date} /><Field label="End date" name="end_date" type="date" defaultValue={position?.end_date} />{status === 'potential' && <Field label="Expected decision date" name="expected_decision_date" type="date" defaultValue={position?.expected_decision_date} />}<Field label="Notes" name="notes" area defaultValue={position?.notes} /></>}
    {modal.kind === 'instrument-type' && <><Field label="Type name" name="name" required defaultValue={instrumentType?.name} /><Field label="Description" name="description" area defaultValue={instrumentType?.description} /></>}
    {modal.kind === 'compensation' && <>
      <label>Compensation type<select name="type" value={compensationType} onChange={(event) => { const next = event.target.value as CompensationType; setCompensationType(next); if (next === 'non_cash') setHasVesting(true); }}><option value="cash">Cash</option><option value="non_cash">Non-cash</option></select></label>
      {compensationType === 'cash' ? <><Field label="Amount" name="amount" type="number" required min="0.01" step="0.01" defaultValue={compensation?.amount} /><Field label="Currency" name="currency" required maxLength={3} defaultValue={compensation?.currency ?? 'USD'} /><label>Frequency<select name="frequency" defaultValue={compensation?.frequency ?? 'annual'}>{(['one_time', 'annual', 'quarterly', 'monthly', 'per_meeting'] as CompensationFrequency[]).map((frequency) => <option key={frequency} value={frequency}>{label(frequency)}</option>)}</select></label><Field label="Notes" name="notes" area defaultValue={compensation?.notes} /></> : <><label>Instrument type<select name="instrument_type_id" required defaultValue={compensation?.instrument_type_id ?? ''}><option value="" disabled>Select a type</option>{instrumentTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="inline-link" onClick={() => { close(); openInstrumentTypes(); }}>Manage instrument types</button><Field label="Quantity" name="quantity" type="number" required min="0.000001" step="any" defaultValue={compensation?.quantity} /><Field label="Grant or strike price per unit (optional)" name="grant_price" type="number" min="0" step="0.01" defaultValue={compensation?.grant_price} /><Field label="Grant date" name="grant_date" type="date" defaultValue={compensation?.grant_date} /><Field label="Notes" name="notes" area defaultValue={compensation?.notes} /><section className="nested-form-section"><label className="checkbox-label"><input type="checkbox" checked={hasVesting} onChange={(event) => setHasVesting(event.target.checked)} />Attach a vesting schedule</label>{hasVesting && <><label>Schedule type<select name="schedule_type" value={scheduleType} onChange={(event) => setScheduleType(event.target.value as VestingScheduleType)}><option value="immediate">Immediate</option><option value="cliff_linear">Cliff and linear</option><option value="milestone">Milestone</option><option value="custom">Custom</option></select></label>{scheduleType === 'cliff_linear' && <><Field label="Vesting start" name="vesting_start" type="date" required defaultValue={schedule?.vesting_start} /><Field label="Cliff date" name="cliff_date" type="date" required defaultValue={schedule?.cliff_date} /><Field label="Vesting end" name="vesting_end" type="date" required defaultValue={schedule?.vesting_end} /><label>Cadence<select name="cadence" defaultValue={schedule?.cadence ?? 'monthly'}>{(['monthly', 'quarterly', 'annual', 'one_time'] as VestingCadence[]).map((cadence) => <option key={cadence} value={cadence}>{label(cadence)}</option>)}</select></label></>}{(scheduleType === 'milestone' || scheduleType === 'custom') && <Field label="Vesting notes" name="vesting_notes" area required defaultValue={schedule?.notes} />}</>}</section></>}</>}
    {error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button" type="submit">Save</button></div>
  </form></section></div>;
}

function Field({ label, name, type = 'text', required, area, defaultValue, ...props }: { label: string; name: string; type?: string; required?: boolean; area?: boolean; defaultValue?: string | number | null; [key: string]: unknown }) { return <label>{label}{area ? <textarea name={name} required={required} defaultValue={defaultValue ?? ''} {...props as object} /> : <input name={name} type={type} required={required} defaultValue={defaultValue ?? ''} {...props as object} />}</label>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><strong>{title}</strong><p>{text}</p></div>; }
export default App;
