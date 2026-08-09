import { FormEvent, useEffect, useState } from 'react';
import { companyResearchPrompt } from '../shared/research-prompt';
import type { Company, CompanyAlias, CompanyDetail, CompanyInput, Compensation, CompensationFrequency, CompensationInput, CompensationType, DashboardData, Document, DocumentInput, ImportBatch, ImportFileResult, ImportNotice, ImportOperation, ImportOperationAction, ImportPlan, ImportSelections, InstrumentType, InstrumentTypeInput, Position, PositionInput, PositionStatus, PositionType, VestingCadence, VestingSchedule, VestingScheduleInput, VestingScheduleType } from '../shared/types';

type Modal = null | { kind: 'company'; item?: Company } | { kind: 'position'; item?: Position } | { kind: 'compensation'; positionId: number; item?: Compensation } | { kind: 'instrument-type'; item?: InstrumentType } | { kind: 'document'; item?: Document; focusFile?: boolean } | { kind: 'research'; item: CompanyDetail };
const documentTypes = ['board_agreement', 'offer_letter', 'grant_agreement', 'nda', 'confirmation_of_shares'];
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const date = (value: string | null | undefined) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
const money = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
const quantity = (value: number | null) => value == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
const fileNameFromPath = (value: string) => value.split(/[\\/]/).pop() || value;
const documentContext = (item: Document) => [item.position_type ? label(item.position_type) : null, item.compensation_type ? `${item.compensation_type === 'non_cash' ? `${quantity(item.compensation_quantity ?? null)} ${item.instrument_type_name || 'instrument'}` : 'Cash'} compensation` : null].filter(Boolean).join(' · ') || 'Company-level document';

function App() {
  const [view, setView] = useState<'dashboard' | 'companies' | 'instrument-types' | 'import'>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [instrumentTypes, setInstrumentTypes] = useState<InstrumentType[]>([]);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [message, setMessage] = useState('');
  const [openFailure, setOpenFailure] = useState<Document | null>(null);
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
  const openDocument = async (item: Document) => { if (!item.file_path) { setOpenFailure(item); return; } try { const result = await window.boardTracker.documents.open(item.file_path); if (!result.ok) { setMessage(`${item.file_name || item.document_type} could not be opened. It may have moved.`); setOpenFailure(item); } } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setOpenFailure(item); } };
  const markMissing = (item: Document) => { void mutate(() => window.boardTracker.documents.update(item.id, { company_id: item.company_id, position_id: item.position_id, compensation_id: item.compensation_id, document_type: item.document_type, file_path: null, file_name: null, description: item.description, document_date: item.document_date, status: 'missing' }), 'Document marked missing.').then(() => setOpenFailure(null)); };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">BT</span><span>Board<br />Tracker</span></div>
      <nav>
        <button className={view === 'dashboard' ? 'nav active' : 'nav'} onClick={() => { setDetail(null); setView('dashboard'); }}>Overview</button>
        <button className={view === 'companies' ? 'nav active' : 'nav'} onClick={() => { setDetail(null); setView('companies'); }}>Companies</button>
        <button className={view === 'instrument-types' ? 'nav active' : 'nav'} onClick={openInstrumentTypes}>Instrument types</button>
        <button className={view === 'import' ? 'nav active' : 'nav'} onClick={() => { setDetail(null); setView('import'); }}>Import extracted data</button>
      </nav>
      <div className="side-bottom"><button className="nav" onClick={importSeed}>Import seed data</button><button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color theme">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button></div>
    </aside>
    <main className="main">
      {message && <div className="toast" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss">×</button></div>}
      {openFailure && <div className="toast document-open-error" role="alert"><span><strong>{openFailure.file_name || label(openFailure.document_type)}</strong> may have moved. Re-link it or keep it as a missing-document reminder.</span><div><button className="toast-action" onClick={() => { setModal({ kind: 'document', item: openFailure, focusFile: true }); setOpenFailure(null); }}>Re-link</button><button className="toast-action" onClick={() => markMissing(openFailure)}>Mark missing</button><button onClick={() => setOpenFailure(null)} aria-label="Dismiss">×</button></div></div>}
      {detail ? <CompanyDetailPage detail={detail} back={() => setDetail(null)} openModal={setModal} openDocument={openDocument} onDelete={() => { if (window.confirm(`Delete ${detail.name}? Its ${detail.positions.length} position(s), compensation, vesting schedules, and ${detail.documents.length} document link(s) will be deleted. The original files will not be deleted.`)) void mutate(() => window.boardTracker.companies.delete(detail.id), 'Company and related records deleted.').then(() => setDetail(null)); }} /> : view === 'dashboard' ? <Dashboard data={dashboard} showCompanies={() => setView('companies')} openCompany={openCompany} /> : view === 'companies' ? <Companies companies={companies} search={search} setSearch={setSearch} openCompany={openCompany} add={() => setModal({ kind: 'company' })} /> : view === 'import' ? <ImportExtractedData notify={setMessage} onImported={() => { refreshDashboard(); refreshCompanies(); refreshInstrumentTypes(); }} /> : <InstrumentTypes types={instrumentTypes} add={() => setModal({ kind: 'instrument-type' })} edit={(item) => setModal({ kind: 'instrument-type', item })} remove={(item) => { if (window.confirm(`Delete ${item.name}? This type cannot be deleted if it is in use by a non-cash compensation record.`)) void mutate(() => window.boardTracker.instrumentTypes.delete(item.id), 'Instrument type deleted.'); }} />}
    </main>
    {modal?.kind === 'research' && <ResearchModal detail={modal.item} close={() => setModal(null)} />}
    {modal && modal.kind !== 'research' && <ModalForm modal={modal} detail={detail} instrumentTypes={instrumentTypes} close={() => setModal(null)} openInstrumentTypes={openInstrumentTypes} submit={mutate} />}
  </div>;
}

const actionLabels: Record<ImportOperationAction, string> = { create: 'New', update: 'Fill in', conflict: 'Conflict', skip: 'Already there', blocked: 'Blocked' };
const kindLabels: Record<ImportOperation['kind'], string> = { company: 'Company', company_fields: 'Company profile', position: 'Position', compensation: 'Compensation', vesting: 'Vesting', document: 'Document', instrument_type: 'Instrument type' };
const enumFields = new Set(['type', 'status', 'position_type', 'frequency', 'schedule_type', 'cadence', 'document_type']);
const changeLabel = (field: string) => field === 'extracted_data_json' ? 'Extracted data' : label(field);
const changeValue = (field: string, value: string) => field === 'extracted_data_json' ? 'Audit payload from the extraction' : enumFields.has(field) ? label(value) : value;
const errorText = (error: unknown) => { const raw = error instanceof Error ? error.message : String(error); return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(ValidationError|Error):\s*/, ''); };

/** The parser reports every problem at once, so render them as a list rather than one sentence. */
function ImportProblem({ problem, pasted }: { problem: string; pasted: boolean }) {
  const [heading, ...items] = problem.split('\n');
  const bullets = items.map((line) => line.replace(/^•\s*/, '')).filter(Boolean);
  return <div className="content-card import-problem" role="alert">
    <strong>{pasted ? 'This JSON could not be read' : 'This file could not be read'}</strong>
    <p>{heading}</p>
    {bullets.length > 0 && <ul className="import-problem-list">{bullets.map((line) => <li key={line}>{line}</li>)}</ul>}
    {bullets.length > 0 && <p className="import-problem-hint">Fix these in the extraction and load it again. Saving the schema file and attaching it to the session prevents most of them.</p>}
  </div>;
}

/** Nothing in the file is discarded silently — anything renamed or untracked is listed here. */
function ImportWarnings({ warnings }: { warnings: ImportNotice[] }) {
  const [open, setOpen] = useState(false);
  const aliases = warnings.filter((warning) => warning.kind === 'alias');
  const unmapped = warnings.filter((warning) => warning.kind === 'unmapped');
  const summary = [aliases.length && `${aliases.length} field${aliases.length === 1 ? '' : 's'} renamed to match the schema`, unmapped.length && `${unmapped.length} record${unmapped.length === 1 ? '' : 's'} had fields the schema does not track`].filter(Boolean).join(' · ');
  return <div className="import-notices">
    <button type="button" className="import-notices-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <span aria-hidden="true">{open ? '▾' : '▸'}</span> How this file was read — {summary}
    </button>
    <p className="import-notices-hint">Untracked fields are saved with the record's audit payload, not discarded, and your own notes are left untouched. Check them below before committing.</p>
    {open && <ul className="import-notices-list">{warnings.map((warning, index) => <li key={`${warning.path}-${index}`} className={`import-notice-${warning.kind}`}><code>{warning.path}</code> {warning.message}</li>)}</ul>}
  </div>;
}

function ImportExtractedData({ notify, onImported }: { notify: (message: string) => void; onImported: () => void }) {
  const [file, setFile] = useState<ImportFileResult | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [selections, setSelections] = useState<ImportSelections>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<ImportPlan | null>(null);
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [copied, setCopied] = useState(false);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const refreshBatches = () => window.boardTracker.extractedImport.batches().then(setBatches).catch(() => undefined);
  useEffect(() => { refreshBatches(); }, []);

  // Re-previewing on every selection change keeps downstream "blocked" states honest when a parent is turned off.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setBusy(true);
    window.boardTracker.extractedImport.preview(file.contents, file.file_name, selections)
      .then((next) => { if (!cancelled) { setPlan(next); setProblem(''); } })
      .catch((error) => { if (!cancelled) { setPlan(null); setProblem(errorText(error)); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [file, selections]);

  const choose = async () => {
    try { const picked = await window.boardTracker.extractedImport.pickFile(); if (!picked) return; setCommitted(null); setSelections({}); setPlan(null); setProblem(''); setPasted(''); setShowPaste(false); setFile(picked); }
    catch (error) { setProblem(errorText(error)); }
  };
  const copyPrompt = async () => { try { await window.boardTracker.extractedImport.copyPrompt(); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch (error) { setProblem(errorText(error)); } };
  const saveSchema = async () => { try { const saved = await window.boardTracker.extractedImport.saveSchema(); if (saved) notify(`Schema saved to ${saved}. Attach it to your Perplexity session with the agreement.`); } catch (error) { setProblem(errorText(error)); } };
  const reviewPasted = () => { const contents = pasted.trim(); if (!contents) return; setCommitted(null); setSelections({}); setPlan(null); setProblem(''); setFile({ file_path: '', file_name: 'Pasted JSON', contents }); };
  const reset = () => { setFile(null); setPlan(null); setSelections({}); setProblem(''); setCommitted(null); setPasted(''); setShowPaste(false); };
  const setAll = (value: boolean) => setSelections(Object.fromEntries((plan?.operations ?? []).filter((operation) => operation.action !== 'skip' && operation.action !== 'blocked').map((operation) => [operation.key, value])));
  const runImport = async () => {
    if (!file || !plan?.selected_count) return;
    setBusy(true);
    try { const result = await window.boardTracker.extractedImport.commit(file.contents, file.file_name, selections); setCommitted(result); setFile(null); setPlan(null); setSelections({}); setPasted(''); setShowPaste(false); refreshBatches(); onImported(); notify(`Imported ${file.file_name}: ${result.counts.create} created, ${result.counts.update + result.counts.conflict} updated.`); }
    catch (error) { setProblem(errorText(error)); }
    finally { setBusy(false); }
  };

  const groups = (plan?.operations ?? []).reduce<Array<{ context: string; operations: ImportOperation[] }>>((accumulator, operation) => { const group = accumulator.find((entry) => entry.context === operation.context); if (group) group.operations.push(operation); else accumulator.push({ context: operation.context, operations: [operation] }); return accumulator; }, []);
  const actionable = plan ? plan.counts.create + plan.counts.update + plan.counts.conflict : 0;

  return <>
    <header className="page-header"><div><p className="eyebrow">Perplexity-assisted intake</p><h1>Import extracted data</h1></div><div className="header-actions">{(file || pasted) && <button className="button secondary" onClick={reset} disabled={busy}>Clear</button>}<button className="button secondary" onClick={() => setShowPaste((current) => !current)} disabled={busy} aria-expanded={showPaste}>{showPaste ? 'Hide paste box' : 'Paste JSON instead'}</button><button className="button" onClick={choose} disabled={busy}>{file ? 'Choose a different file' : 'Choose JSON file'}</button></div></header>

    <section className="content-card import-intro">
      <ol className="import-steps">
        <li>Start a Perplexity session, attach the agreement, and paste the extraction prompt.</li>
        <li>Copy the JSON it returns, or save it as a <code>.json</code> file.</li>
        <li>Paste or load it here, review every change, then commit the ones you want.</li>
      </ol>
      <p className="import-hint">Board Tracker does not read documents and makes no network calls — the extraction happens in your Perplexity session, and the app only reads the JSON you give it. The format is documented in <code>docs/import-schema.md</code>, with a worked example in <code>docs/import-example.json</code>.</p>
      <div className="import-prompt-actions"><button className="button secondary" onClick={copyPrompt} disabled={busy}>{copied ? 'Prompt copied' : 'Copy extraction prompt'}</button><button className="button secondary" onClick={saveSchema} disabled={busy}>Save schema file…</button>{copied && <small role="status">Paste it into a Perplexity session together with the agreement.</small>}</div>
    </section>

    {showPaste && <section className="content-card import-paste">
      <div className="section-heading"><div><p className="eyebrow">No file needed</p><h2>Paste JSON</h2></div></div>
      <div className="import-body"><label className="import-paste-label" htmlFor="import-paste-box">Paste the JSON from your Perplexity session and review it before anything is written.</label>
      <textarea id="import-paste-box" className="import-paste-box" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={'{\n  "schema": "board-tracker.import",\n  "schema_version": 1,\n  "companies": [ ... ]\n}'} spellCheck={false} rows={10} />
      <div className="import-commit"><button className="button" onClick={reviewPasted} disabled={busy || !pasted.trim()}>Review pasted JSON</button>{!pasted.trim() && <small>Paste the JSON above to review it.</small>}</div></div>
    </section>}

    {problem && <ImportProblem problem={problem} pasted={Boolean(pasted)} />}

    {committed && <div className="content-card import-result" role="status"><strong>Import complete</strong><p>{committed.counts.create} record{committed.counts.create === 1 ? '' : 's'} created and {committed.counts.update + committed.counts.conflict} updated from <code>{committed.source.label}</code>. The raw extraction payload was saved as batch #{committed.batch_id} for the audit trail.</p></div>}

    {file && plan && <section className="content-card">
      <div className="section-heading"><div><p className="eyebrow">{file.file_name}</p><h2>Review before commit</h2>{plan && <p className="import-source">{[plan.source.tool && `Extracted with ${plan.source.tool}`, plan.generated_at && `generated ${date(plan.generated_at)}`, plan.source.notes].filter(Boolean).join(' · ')}</p>}</div>{plan && actionable > 0 && <div className="header-actions"><button className="button secondary" onClick={() => setAll(true)} disabled={busy}>Select all</button><button className="button secondary" onClick={() => setAll(false)} disabled={busy}>Select none</button></div>}</div>

      <div className="import-body">
      {plan && <div className="import-counts">{(['create', 'update', 'conflict', 'skip', 'blocked'] as ImportOperationAction[]).filter((action) => plan.counts[action] > 0).map((action) => <span key={action} className={`badge import-${action}`}>{plan.counts[action]} {actionLabels[action].toLowerCase()}</span>)}</div>}

      {plan && plan.warnings.length > 0 && <ImportWarnings warnings={plan.warnings} />}

      {plan && plan.counts.conflict > 0 && <p className="import-warning" role="note">Conflicts are switched off by default because applying them would replace a value you already have. Tick one only after checking the before and after values below.</p>}

      {plan && !actionable && <Empty title="Everything in this file is already recorded" text="No new records and no changes were found, so there is nothing to commit." />}

      {groups.map((group) => <div className="import-group" key={group.context}>
        <h3>{group.context}</h3>
        {group.operations.map((operation) => {
          const decidable = operation.action !== 'skip' && operation.action !== 'blocked';
          return <div className={`import-row import-${operation.action}`} key={operation.key}>
            <label className="import-choice">
              <input type="checkbox" checked={operation.selected} disabled={!decidable || busy} onChange={(event) => setSelections((current) => ({ ...current, [operation.key]: event.target.checked }))} aria-label={`${actionLabels[operation.action]}: ${operation.label}`} />
              <span><strong>{operation.label}</strong><small>{kindLabels[operation.kind]} · {operation.reason}</small></span>
            </label>
            <span className={`badge import-${operation.action}`}>{actionLabels[operation.action]}</span>
            {operation.changes.length > 0 && <ul className="import-changes">{operation.changes.map((change) => <li key={change.field} className={change.overwrite ? 'overwrite' : undefined}><span className="import-field">{changeLabel(change.field)}</span>{change.from == null ? <span className="import-to">{changeValue(change.field, change.to)}</span> : <><span className="import-from">{changeValue(change.field, change.from)}</span><span aria-hidden="true"> → </span><span className="import-to">{changeValue(change.field, change.to)}</span></>}</li>)}</ul>}
          </div>;
        })}
      </div>)}

      {plan && actionable > 0 && <div className="import-commit"><button className="button" onClick={runImport} disabled={busy || !plan.selected_count}>{busy ? 'Checking…' : `Import ${plan.selected_count} selected change${plan.selected_count === 1 ? '' : 's'}`}</button>{!plan.selected_count && <small>Select at least one change to import.</small>}</div>}
      </div>
    </section>}

    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Audit trail</p><h2>Previous imports</h2></div></div>{batches.length ? <div className="upcoming-list">{batches.map((batch) => <div className="upcoming-row static" key={batch.id}><span><strong>#{batch.id} · {batch.source_label}</strong><small>{[batch.source_tool, batch.generated_at && `generated ${date(batch.generated_at)}`, batch.summary_json && summarizeBatch(batch.summary_json)].filter(Boolean).join(' · ')}</small></span><time>{new Date(batch.imported_at.replace(' ', 'T') + 'Z').toLocaleString()}</time></div>)}</div> : <Empty title="No imports yet" text="Committed import files and their raw extraction payloads are listed here." />}</section>
  </>;
}

function summarizeBatch(summary: string): string {
  try { const counts = JSON.parse(summary) as Record<string, number>; return `${counts.create ?? 0} created, ${(counts.update ?? 0) + (counts.conflict ?? 0)} updated, ${counts.skip ?? 0} unchanged`; } catch { return ''; }
}

function Dashboard({ data, showCompanies, openCompany }: { data: DashboardData | null; showCompanies: () => void; openCompany: (id: number) => void }) {
  return <>
    <header className="page-header"><div><p className="eyebrow">Board position portfolio</p><h1>Overview</h1></div><button className="button secondary" onClick={showCompanies}>Manage companies</button></header>
    <section className="metric-grid">{(['current', 'former', 'potential'] as PositionStatus[]).map((status) => <article className={`metric ${status}`} key={status}><span>{label(status)} positions</span><strong>{data?.counts[status] ?? 0}</strong></article>)}</section>
    <section className="content-card dashboard-card"><div className="section-heading"><div><p className="eyebrow">Pipeline</p><h2>Upcoming decisions</h2></div></div>{data?.upcoming.length ? <div className="upcoming-list">{data.upcoming.map((position) => <button key={position.id} className="upcoming-row" onClick={() => openCompany(position.company_id)}><span><strong>{position.company_name}</strong><small>{label(position.position_type)}</small></span><time>{date(position.expected_decision_date)}</time></button>)}</div> : <Empty title="No upcoming decisions" text="Potential positions with a decision date will appear here." />}</section>
    <section className="content-card dashboard-card"><div className="section-heading"><div><p className="eyebrow">Equity</p><h2>Upcoming vesting</h2></div></div>{data?.upcoming_vesting.length ? <> <div className="upcoming-list">{data.upcoming_vesting.map((schedule) => <button key={schedule.id} className="upcoming-row" onClick={() => openCompany(schedule.company_id)}><span><strong>{schedule.company_name}</strong><small>{quantity(schedule.quantity)} {schedule.instrument_type_name || 'instrument'} · {schedule.vesting_summary.text}</small></span><time>Ends {date(schedule.effective_vesting_end ?? schedule.vesting_end)}{schedule.vesting_end_is_derived ? '*' : ''}</time></button>)}</div>{data.upcoming_vesting.some((schedule) => schedule.vesting_end_is_derived) && <p className="derived-note">* End date worked out from the vesting term, not stated in the agreement.</p>} </> : <Empty title="No active vesting" text="Cliff and linear awards that are currently vesting will appear here." />}</section>
    <section className="content-card dashboard-card"><div className="section-heading"><div><p className="eyebrow">Paperwork</p><h2>Missing documents</h2></div></div>{data?.missing_documents.length ? <div className="upcoming-list">{data.missing_documents.map((item) => <button key={item.id} className="upcoming-row" onClick={() => openCompany(item.company_id)}><span><strong>{item.company_name}</strong><small>{label(item.document_type)} · {documentContext(item)}</small></span><time>Missing</time></button>)}</div> : <Empty title="No missing documents" text="Expected documents you have not received will appear here." />}</section>
  </>;
}

function Companies({ companies, search, setSearch, openCompany, add }: { companies: Company[]; search: string; setSearch: (value: string) => void; openCompany: (id: number) => void; add: () => void }) {
  return <><header className="page-header"><div><p className="eyebrow">Directory</p><h1>Companies</h1></div><button className="button" onClick={add}>Add company</button></header><section className="content-card table-card"><div className="toolbar"><input aria-label="Search companies" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by company name" /><span>{companies.length} total</span></div>{companies.length ? <table><thead><tr><th>Company</th><th>Sector</th><th>Positions</th></tr></thead><tbody>{companies.map((company) => <tr key={company.id} tabIndex={0} onClick={() => openCompany(company.id)} onKeyDown={(event) => event.key === 'Enter' && openCompany(company.id)}><td><strong>{company.name}</strong></td><td>{company.sector || '—'}</td><td>{company.position_count ?? 0}</td></tr>)}</tbody></table> : <Empty title="No companies found" text="Add a company or import the seed data to begin." />}</section></>;
}

function InstrumentTypes({ types, add, edit, remove }: { types: InstrumentType[]; add: () => void; edit: (item: InstrumentType) => void; remove: (item: InstrumentType) => void }) {
  return <><header className="page-header"><div><p className="eyebrow">Settings</p><h1>Instrument types</h1><p className="lede">Manage the equity and non-cash award types available in compensation records.</p></div><button className="button" onClick={add}>Add type</button></header><section className="content-card table-card">{types.length ? <table><thead><tr><th>Name</th><th>Description</th><th aria-label="Actions" /></tr></thead><tbody>{types.map((item) => <tr className="static-row" key={item.id}><td><strong>{item.name}</strong></td><td>{item.description || '—'}</td><td className="row-actions"><button onClick={() => edit(item)}>Edit</button><button className="text-danger" onClick={() => remove(item)}>Delete</button></td></tr>)}</tbody></table> : <Empty title="No instrument types" text="Add an award type to use it in non-cash compensation." />}</section></>;
}

/** Names this company was previously known by. Shown because they silently affect import matching. */
function FormerNames({ detail }: { detail: CompanyDetail }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const refresh = () => window.dispatchEvent(new Event('records-changed'));
  const add = async () => {
    setError('');
    try { await window.boardTracker.companies.addAlias(detail.id, value); setValue(''); setAdding(false); refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const remove = async (alias: CompanyAlias) => {
    if (!window.confirm(`Stop matching imports on "${alias.name}"? A file that still uses that name will create a new company instead of updating this one.`)) return;
    await window.boardTracker.companies.deleteAlias(alias.id); refresh();
  };
  if (!detail.aliases.length && !adding) return <div className="former-names-empty"><button type="button" className="inline-link" onClick={() => setAdding(true)}>Add a former name</button></div>;
  return <section className="former-names">
    <h2>Also known as</h2>
    <p className="former-names-hint">Imports match on these as well as the current name, so a file written before a rename still updates this company instead of creating a second one.</p>
    {detail.aliases.length > 0 && <ul className="former-names-list">{detail.aliases.map((alias) => <li key={alias.id}><span>{alias.name}</span><small>{alias.source === 'rename' ? 'previous name' : 'added by you'}</small><button type="button" className="text-danger" onClick={() => void remove(alias)}>Remove</button></li>)}</ul>}
    {adding
      ? <div className="former-names-add"><input value={value} autoFocus placeholder="Name used in older files" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void add(); }} /><button type="button" className="button secondary" onClick={() => void add()} disabled={!value.trim()}>Add</button><button type="button" className="inline-link" onClick={() => { setAdding(false); setValue(''); setError(''); }}>Cancel</button></div>
      : <button type="button" className="inline-link" onClick={() => setAdding(true)}>Add another former name</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

/**
 * Board Tracker makes no network calls, so researching a company means handing you a prompt to run
 * in a Perplexity session. The answer comes back as an ordinary import file and goes through the
 * same review-before-commit screen as an agreement, so nothing is written without your approval.
 */
function ResearchModal({ detail, close }: { detail: CompanyDetail; close: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState('');
  const prompt = companyResearchPrompt(detail.name, detail.website);
  const copy = async () => { await window.boardTracker.companies.copyResearchPrompt(detail.name, detail.website); setCopied(true); setTimeout(() => setCopied(false), 2500); };
  const saveSchema = async () => { const path = await window.boardTracker.extractedImport.saveSchema(); if (path) setSaved(path); };
  useBackgroundScrollLock();
  return <div className="modal-backdrop" role="presentation"><section className="modal research-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div className="modal-header"><h2 id="modal-title">Research {detail.name}</h2><button onClick={close} aria-label="Close dialog">×</button></div>
    <div>
      <ol className="research-steps">
        <li>Copy the prompt below and run it in a Perplexity session.</li>
        <li>Attach the schema file so the answer comes back in the right shape.</li>
        <li>Paste the JSON into <strong>Import extracted data</strong> and review it before anything is written.</li>
      </ol>
      <p className="research-note">Board Tracker makes no network calls of its own. The research happens in your browser session, and the app only reads the JSON you bring back — as a normal import, with every field reviewable and nothing overwritten silently.</p>
      <textarea className="research-prompt" readOnly rows={12} value={prompt} onFocus={(event) => event.currentTarget.select()} aria-label="Research prompt" />
      <div className="research-actions">
        <button type="button" className="button" onClick={() => void copy()}>{copied ? 'Prompt copied' : 'Copy prompt'}</button>
        <button type="button" className="button secondary" onClick={() => void saveSchema()}>Save schema file…</button>
        <button type="button" className="button secondary" onClick={close}>Done</button>
      </div>
      {saved && <p className="research-saved" role="status">Schema saved to {saved}</p>}
    </div>
  </section></div>;
}

function CompanyDetailPage({ detail, back, openModal, openDocument, onDelete }: { detail: CompanyDetail; back: () => void; openModal: (modal: Modal) => void; openDocument: (item: Document) => void; onDelete: () => void }) {
  const field = (name: string, value: string | number | null | undefined) => value != null && value !== '' ? <div className="detail-field"><dt>{name}</dt><dd>{value}</dd></div> : null;
  return <>
    <header className="page-header detail-header"><div><button className="back" onClick={back}>← Companies</button><p className="eyebrow">Company record</p><h1>{detail.name}</h1><p className="lede">{detail.sector || 'No sector entered'}</p></div><div className="header-actions"><button className="button secondary" onClick={() => openModal({ kind: 'research', item: detail })}>Research this company</button><button className="button secondary" onClick={() => openModal({ kind: 'company', item: detail })}>Edit company</button><button className="button danger" onClick={onDelete}>Delete</button></div></header>
    <FormerNames detail={detail} />
    <section className="company-info content-card"><dl>{field('Business summary', detail.business_summary)}{field('Website', detail.website)}{field('Board size', detail.board_size)}{field('Other board members', detail.other_board_members)}{field('Meeting cadence', detail.meeting_cadence)}{field('Notes', detail.notes)}</dl></section>
    <section className="documents-section"><div className="section-heading"><div><p className="eyebrow">Records</p><h2>Documents</h2></div><button className="button" onClick={() => openModal({ kind: 'document' })}>Link document</button></div>{detail.documents.length ? <div className="document-list">{detail.documents.map((item) => <article className={`document-card ${item.status}`} key={item.id}><div className="document-title"><div><span className={`badge ${item.status}`}>{item.status}</span><h3>{item.file_name || label(item.document_type)}</h3><p>{label(item.document_type)} · {documentContext(item)}{item.document_date ? ` · ${date(item.document_date)}` : ''}</p></div><div className="compact-actions">{item.status === 'missing' ? <button onClick={() => openModal({ kind: 'document', item, focusFile: true })}>Attach file now</button> : <button onClick={() => void openDocument(item)}>Open</button>}<button onClick={() => openModal({ kind: 'document', item })}>Edit</button><button className="text-danger" onClick={() => { if (window.confirm('Delete this document record? This removes only the Board Tracker link and metadata; the original file on disk will not be deleted.')) void window.boardTracker.documents.delete(item.id).then(() => window.dispatchEvent(new Event('records-changed'))); }}>Delete</button></div></div>{item.description && <p className="document-description">{item.description}</p>}{item.status === 'missing' && <p className="missing-note">This expected document has not been linked yet.</p>}</article>)}</div> : <Empty title="No documents linked" text="Link agreements, grant records, and other files without copying them into the app." />}</section>
    <section className="positions-section"><div className="section-heading"><div><p className="eyebrow">Appointments</p><h2>Positions</h2></div><button className="button" onClick={() => openModal({ kind: 'position' })}>Add position</button></div>{detail.positions.length ? <div className="position-list">{detail.positions.map((position) => <article className="position-card" key={position.id}><div className="position-title"><div><span className={`badge ${position.status}`}>{position.status}</span><h3>{label(position.position_type)}</h3><p>{position.start_date ? `${date(position.start_date)}${position.end_date ? ` – ${date(position.end_date)}` : ''}` : 'Dates not entered'}{position.status === 'potential' && ` · Decision: ${date(position.expected_decision_date)}`}</p></div><div className="compact-actions"><button onClick={() => openModal({ kind: 'position', item: position })}>Edit</button><button className="text-danger" onClick={() => { if (window.confirm('Delete this position, its compensation, and vesting schedules? Linked documents will be kept, but their position and compensation links will be removed.')) void window.boardTracker.positions.delete(position.id).then(() => window.dispatchEvent(new Event('records-changed'))); }}>Delete</button></div></div>{position.notes && <p className="position-notes">{position.notes}</p>}<div className="comp-heading"><h4>Compensation</h4><button onClick={() => openModal({ kind: 'compensation', positionId: position.id })}>Add compensation</button></div>{position.compensation.length ? <div className="comp-list">{position.compensation.map((compensation) => <CompensationRow key={compensation.id} compensation={compensation} edit={() => openModal({ kind: 'compensation', positionId: position.id, item: compensation })} remove={() => { if (window.confirm('Delete this compensation entry and any vesting schedules? Linked documents will be kept, but their compensation link will be removed.')) void window.boardTracker.compensation.delete(compensation.id).then(() => window.dispatchEvent(new Event('records-changed'))); }} />)}</div> : <p className="muted">No compensation entered.</p>}</article>)}</div> : <Empty title="No positions yet" text="Add a current, former, or potential position for this company." />}</section>
  </>;
}

/** Say when vesting finishes, and be plain about whether that date was stated or worked out. */
function vestingEndNote(schedule: VestingSchedule | null | undefined): string {
  const end = schedule?.effective_vesting_end;
  if (!end) return '';
  if (!schedule?.vesting_end_is_derived) return ` · Ends ${date(end)}`;
  return ` · Ends ${date(end)}, from a ${schedule.duration_months}-month term`;
}

/**
 * Hold the page still while a dialog is open.
 *
 * Without this, a wheel over the dialog scrolls the dialog until it reaches its end and then
 * chains through to the page behind it. On Windows that also dismisses an open native select or
 * date picker, which reads as "the dropdown ignored my click". Hiding the overflow leaves a
 * scrollbar-width gap, so pad the difference back to stop the layout jumping as dialogs open.
 */
function useBackgroundScrollLock() {
  useEffect(() => {
    const { body, documentElement } = document;
    const gutter = window.innerWidth - documentElement.clientWidth;
    const overflow = body.style.overflow;
    const paddingRight = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    return () => { body.style.overflow = overflow; body.style.paddingRight = paddingRight; };
  }, []);
}

function CompensationRow({ compensation, edit, remove }: { compensation: Compensation; edit: () => void; remove: () => void }) {
  const nonCash = compensation.type === 'non_cash';
  return <div className="comp-row"><span><strong>{nonCash ? `${quantity(compensation.quantity)} ${compensation.instrument_type_name || 'instrument units'}` : money(compensation.amount ?? 0, compensation.currency || 'USD')}</strong><small>{nonCash ? `${compensation.grant_price == null ? 'No grant price' : `${money(compensation.grant_price, 'USD')} per unit`}${compensation.grant_date ? ` · Granted ${date(compensation.grant_date)}` : ''}` : label(compensation.frequency || 'one_time')}{compensation.notes ? ` · ${compensation.notes}` : ''}</small>{nonCash && <small className="vesting-line">Vesting: {compensation.vesting_summary?.text || 'No vesting schedule'}{vestingEndNote(compensation.active_vesting_schedule)}</small>}</span><div className="compact-actions"><button onClick={edit}>Edit</button><button className="text-danger" onClick={remove}>Delete</button></div></div>;
}

function ModalForm({ modal, detail, instrumentTypes, close, openInstrumentTypes, submit }: { modal: Exclude<Modal, null>; detail: CompanyDetail | null; instrumentTypes: InstrumentType[]; close: () => void; openInstrumentTypes: () => void; submit: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const company = modal.kind === 'company' ? modal.item : undefined;
  const position = modal.kind === 'position' ? modal.item : undefined;
  const compensation = modal.kind === 'compensation' ? modal.item : undefined;
  const instrumentType = modal.kind === 'instrument-type' ? modal.item : undefined;
  const documentItem = modal.kind === 'document' ? modal.item : undefined;
  const schedule = compensation?.active_vesting_schedule;
  const [status, setStatus] = useState<PositionStatus>(position?.status ?? 'current');
  const [compensationType, setCompensationType] = useState<CompensationType>(compensation?.type ?? 'cash');
  const [hasVesting, setHasVesting] = useState(Boolean(schedule));
  const [scheduleType, setScheduleType] = useState<VestingScheduleType>(schedule?.schedule_type ?? 'immediate');
  const [missing, setMissing] = useState(documentItem?.status === 'missing');
  const [filePath, setFilePath] = useState(documentItem?.file_path ?? '');
  const [fileName, setFileName] = useState(documentItem?.file_name ?? '');
  const [documentType, setDocumentType] = useState(documentItem && documentTypes.includes(documentItem.document_type) ? documentItem.document_type : 'other');
  const [customDocumentType, setCustomDocumentType] = useState(documentItem && !documentTypes.includes(documentItem.document_type) ? documentItem.document_type : '');
  const [documentPositionId, setDocumentPositionId] = useState(documentItem?.position_id ? String(documentItem.position_id) : '');
  const [documentCompensationId, setDocumentCompensationId] = useState(documentItem?.compensation_id ? String(documentItem.compensation_id) : '');
  const [companyName, setCompanyName] = useState(company?.name ?? '');
  const [error, setError] = useState('');
  const pickFile = async () => { try { const picked = await window.boardTracker.documents.pickFile(); if (picked) { setFilePath(picked); if (!fileName) setFileName(fileNameFromPath(picked)); setMissing(false); } } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } };
  useEffect(() => { if (modal.kind === 'document' && modal.focusFile) void pickFile(); }, []);
  const heading = modal.kind === 'company' ? `${company ? 'Edit' : 'Add'} company` : modal.kind === 'position' ? `${position ? 'Edit' : 'Add'} position` : modal.kind === 'instrument-type' ? `${instrumentType ? 'Edit' : 'Add'} instrument type` : modal.kind === 'document' ? `${documentItem ? 'Edit' : 'Link'} document` : `${compensation ? 'Edit' : 'Add'} compensation`;
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
      } else if (modal.kind === 'document' && detail) {
        const input: DocumentInput = { company_id: detail.id, position_id: documentPositionId ? Number(documentPositionId) : null, compensation_id: documentCompensationId ? Number(documentCompensationId) : null, document_type: documentType === 'other' ? customDocumentType : documentType, file_path: missing ? null : filePath, file_name: missing ? null : fileName, description: String(form.get('description') || ''), document_date: String(form.get('document_date') || ''), status: missing ? 'missing' : 'linked' };
        void submit(() => documentItem ? window.boardTracker.documents.update(documentItem.id, input) : window.boardTracker.documents.create(input), missing ? 'Missing document tracked.' : 'Document linked.');
      } else if (modal.kind === 'compensation') {
        const input: CompensationInput = compensationType === 'cash' ? { position_id: modal.positionId, type: 'cash', amount: Number(form.get('amount')), currency: String(form.get('currency') || 'USD'), frequency: String(form.get('frequency')) as CompensationFrequency, notes: String(form.get('notes') || '') } : { position_id: modal.positionId, type: 'non_cash', instrument_type_id: Number(form.get('instrument_type_id')), quantity: Number(form.get('quantity')), grant_price: form.get('grant_price') ? Number(form.get('grant_price')) : null, grant_date: String(form.get('grant_date') || ''), notes: String(form.get('notes') || '') };
        const vestingInput = (): Omit<VestingScheduleInput, 'compensation_id'> => ({ schedule_type: scheduleType, cliff_date: form.get('cliff_date') ? String(form.get('cliff_date')) : null, vesting_start: form.get('vesting_start') ? String(form.get('vesting_start')) : null, vesting_end: form.get('vesting_end') ? String(form.get('vesting_end')) : null, duration_months: form.get('duration_months') ? String(form.get('duration_months')) : null, cadence: form.get('cadence') ? (String(form.get('cadence')) as VestingCadence) : null, notes: form.get('vesting_notes') ? String(form.get('vesting_notes')) : null });
        void submit(async () => {
          const saved = compensation ? await window.boardTracker.compensation.update(compensation.id, input) : await window.boardTracker.compensation.create(input);
          if (compensationType === 'non_cash' && hasVesting) { const scheduleData = { compensation_id: saved.id, ...vestingInput() }; if (schedule) await window.boardTracker.vestingSchedules.update(schedule.id, scheduleData); else await window.boardTracker.vestingSchedules.create(scheduleData); }
          else if (schedule) await window.boardTracker.vestingSchedules.delete(schedule.id);
          return saved;
        }, `${compensationType === 'cash' ? 'Cash' : 'Non-cash'} compensation saved.`);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  useBackgroundScrollLock();
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{heading}</h2><button onClick={close} aria-label="Close dialog">×</button></div><form onSubmit={onSubmit}>
    {modal.kind === 'company' && <><label>Company name<input name="name" required value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>{company && companyName.trim() && companyName.trim().toLowerCase() !== company.name.toLowerCase() && <p className="rename-note" role="status">“{company.name}” will be kept as a former name, so imports written against it still match this company.</p>}<Field label="Sector" name="sector" defaultValue={company?.sector} /><Field label="Website" name="website" defaultValue={company?.website} /><Field label="Board size" name="board_size" type="number" min="0" defaultValue={company?.board_size ?? ''} /><Field label="Business summary" name="business_summary" area defaultValue={company?.business_summary} /><Field label="Other board members" name="other_board_members" area defaultValue={company?.other_board_members} /><Field label="Meeting cadence" name="meeting_cadence" defaultValue={company?.meeting_cadence} /><Field label="Notes" name="notes" area defaultValue={company?.notes} /></>}
    {modal.kind === 'position' && <><p className="form-context">Company: <strong>{detail?.name}</strong></p><label>Status<select name="status" value={status} onChange={(event) => setStatus(event.target.value as PositionStatus)}><option value="current">Current</option><option value="former">Former</option><option value="potential">Potential</option></select></label><label>Position type<select name="position_type" defaultValue={position?.position_type ?? 'governing_board'}><option value="governing_board">Governing board</option><option value="advisory_board">Advisory board</option><option value="advisor">Advisor</option></select></label><Field label="Start date" name="start_date" type="date" defaultValue={position?.start_date} /><Field label="End date" name="end_date" type="date" defaultValue={position?.end_date} />{status === 'potential' && <Field label="Expected decision date" name="expected_decision_date" type="date" defaultValue={position?.expected_decision_date} />}<Field label="Notes" name="notes" area defaultValue={position?.notes} /></>}
    {modal.kind === 'instrument-type' && <><Field label="Type name" name="name" required defaultValue={instrumentType?.name} /><Field label="Description" name="description" area defaultValue={instrumentType?.description} /></>}
    {modal.kind === 'document' && <><p className="form-context">Company: <strong>{detail?.name}</strong></p><label>Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{documentTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}<option value="other">Other</option></select></label>{documentType === 'other' && <label>Custom document type<input name="custom_document_type" required value={customDocumentType} onChange={(event) => setCustomDocumentType(event.target.value)} /></label>}<label>Position (optional)<select value={documentPositionId} onChange={(event) => setDocumentPositionId(event.target.value)}><option value="">Company-level document</option>{detail?.positions.map((item) => <option key={item.id} value={item.id}>{label(item.position_type)} · {label(item.status)}</option>)}</select></label><label>Compensation record (optional)<select value={documentCompensationId} onChange={(event) => { setDocumentCompensationId(event.target.value); const owner = detail?.positions.find((item) => item.compensation.some((record) => record.id === Number(event.target.value))); if (owner) setDocumentPositionId(String(owner.id)); }}><option value="">No compensation record</option>{detail?.positions.flatMap((item) => item.compensation.map((record) => <option key={record.id} value={record.id}>{label(item.position_type)} · {record.type === 'non_cash' ? `${quantity(record.quantity)} ${record.instrument_type_name || 'instrument'}` : money(record.amount ?? 0, record.currency || 'USD')}</option>))}</select></label><label className="checkbox-label"><input type="checkbox" checked={missing} onChange={(event) => { setMissing(event.target.checked); if (event.target.checked) { setFilePath(''); setFileName(''); } }} />I don't have this document yet — track it as missing</label>{!missing && <><div className="file-picker"><label>File path<input name="file_path" readOnly value={filePath} placeholder="Pick a file to link" /></label><button type="button" className="button secondary" onClick={() => void pickFile()}>Pick file</button></div><label>Display name<input name="file_name" required value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="Name shown in Board Tracker" /></label></>}<Field label="Description" name="description" area defaultValue={documentItem?.description} /><Field label="Document date" name="document_date" type="date" defaultValue={documentItem?.document_date} /></>}
    {modal.kind === 'compensation' && <>
      <label>Compensation type<select name="type" value={compensationType} onChange={(event) => { const next = event.target.value as CompensationType; setCompensationType(next); if (next === 'non_cash') setHasVesting(true); }}><option value="cash">Cash</option><option value="non_cash">Non-cash</option></select></label>
      {compensationType === 'cash' ? <><Field label="Amount" name="amount" type="number" required min="0.01" step="0.01" defaultValue={compensation?.amount} /><Field label="Currency" name="currency" required maxLength={3} defaultValue={compensation?.currency ?? 'USD'} /><label>Frequency<select name="frequency" defaultValue={compensation?.frequency ?? 'annual'}>{(['one_time', 'annual', 'quarterly', 'monthly', 'per_meeting'] as CompensationFrequency[]).map((frequency) => <option key={frequency} value={frequency}>{label(frequency)}</option>)}</select></label><Field label="Notes" name="notes" area defaultValue={compensation?.notes} /></> : <><label>Instrument type<select name="instrument_type_id" required defaultValue={compensation?.instrument_type_id ?? ''}><option value="" disabled>Select a type</option>{instrumentTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="inline-link" onClick={() => { close(); openInstrumentTypes(); }}>Manage instrument types</button><Field label="Quantity" name="quantity" type="number" required min="0.000001" step="any" defaultValue={compensation?.quantity} /><Field label="Grant or strike price per unit (optional)" name="grant_price" type="number" min="0" step="0.01" defaultValue={compensation?.grant_price} /><Field label="Grant date" name="grant_date" type="date" defaultValue={compensation?.grant_date} /><Field label="Notes" name="notes" area defaultValue={compensation?.notes} /><section className="nested-form-section"><label className="checkbox-label"><input type="checkbox" checked={hasVesting} onChange={(event) => setHasVesting(event.target.checked)} />Attach a vesting schedule</label>{hasVesting && <><label>Schedule type<select name="schedule_type" value={scheduleType} onChange={(event) => setScheduleType(event.target.value as VestingScheduleType)}><option value="immediate">Immediate</option><option value="cliff_linear">Cliff and linear</option><option value="milestone">Milestone</option><option value="custom">Custom</option></select></label>{scheduleType === 'cliff_linear' && <><Field label="Vesting start" name="vesting_start" type="date" required defaultValue={schedule?.vesting_start} /><Field label="Cliff date" name="cliff_date" type="date" required defaultValue={schedule?.cliff_date} /><Field label="Vesting end (if the agreement states one)" name="vesting_end" type="date" defaultValue={schedule?.vesting_end} /><Field label="Vesting term in months (if it states a term instead)" name="duration_months" type="number" min="1" max="600" step="1" defaultValue={schedule?.duration_months ?? ''} /><p className="field-hint">Fill in whichever the agreement gives. Percent vested needs one of them; with a term, the end date is worked out from the vesting start.</p><label>Cadence<select name="cadence" defaultValue={schedule?.cadence ?? 'monthly'}>{(['monthly', 'quarterly', 'annual', 'one_time'] as VestingCadence[]).map((cadence) => <option key={cadence} value={cadence}>{label(cadence)}</option>)}</select></label></>}{(scheduleType === 'milestone' || scheduleType === 'custom') && <Field label="Vesting notes" name="vesting_notes" area required defaultValue={schedule?.notes} />}</>}</section></>}</>}
    {error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button" type="submit">Save</button></div>
  </form></section></div>;
}

function Field({ label, name, type = 'text', required, area, defaultValue, ...props }: { label: string; name: string; type?: string; required?: boolean; area?: boolean; defaultValue?: string | number | null; [key: string]: unknown }) { return <label>{label}{area ? <textarea name={name} required={required} defaultValue={defaultValue ?? ''} {...props as object} /> : <input name={name} type={type} required={required} defaultValue={defaultValue ?? ''} {...props as object} />}</label>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><strong>{title}</strong><p>{text}</p></div>; }
export default App;
