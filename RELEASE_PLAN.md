# Board Position Tracker — Release Plan

Repo: https://github.com/anndunkin/board-tracker

## Product summary

A Windows desktop app (Electron + React + SQLite, matching the stack used in
Address Book, Inkwell, IDP Manager, etc.) to track current, past, and
potential board and advisory positions: the company, your status and role
type, cash and non-cash compensation (with configurable equity instrument
types and vesting schedules), linked source documents, and missing-document
tracking.

## Confirmed decisions

- **Doc parsing:** Perplexity-assisted, semi-automated. The app never calls
  an external AI API. When you have new agreements, you bring them to a
  Perplexity session; the session extracts structured fields and produces an
  import file (JSON) that the app ingests via an "Import Extracted Data"
  screen. Keeps the app fully offline, free, and simple.
- **Storage:** Unencrypted local SQLite (`better-sqlite3`), consistent with
  most of your other apps (not Vault-style encryption).
- **Documents:** Linked, not copied. The app stores a path/reference to each
  document's original location (Inkwell's model) and opens it with the
  system default handler. You keep documents wherever you already keep them.
- **Repo:** Public at `anndunkin/board-tracker`, matching Address Book/Inkwell
  visibility. I'll flag when it's safe to pull private/sensitive data out if
  that ever becomes a concern.
- **Seed data:** The company names + business summaries from the existing
  "Company Intelligence" spreadsheet seed the Companies table. Board-specific
  fields (status, position type, compensation, documents) are not in that
  spreadsheet and will be entered fresh per company.

## Data model (initial)

- **Companies** — name, business summary, sector, website, board_size
  (nullable int), other_board_members (free text or linked list of names),
  meeting_cadence (e.g. monthly/quarterly/ad hoc), notes.
- **Positions** — company_id, status (current / former / potential),
  position_type (governing board / advisory board / advisor), start date,
  end date (nullable), expected_decision_date (nullable, used when status =
  potential), notes.
- **Compensation** — position_id, type (cash / non-cash), amount/currency
  (cash) OR instrument_type + quantity + strike/grant price (non-cash),
  grant_date.
- **Instrument Types** — configurable lookup table (stock, options, RSUs,
  warrants, profits interest, etc.) — user-extensible, seeded with common
  types. Mirrors the configurable-taxonomy pattern from Inkwell/Elite.
- **Vesting Schedules** — compensation_id, schedule_type (cliff+linear,
  milestone-based, immediate, custom), cliff_date, vesting_start,
  vesting_end, cadence (monthly/quarterly/annual), custom notes.
- **Documents** — company_id or position_id, doc_type (board agreement,
  stock grant, share confirmation, advisory agreement, other), file_path
  (linked, not copied), title, date_added, extracted_data_json (raw
  extraction payload from the Perplexity-assisted import, for audit trail).
- **Missing Document Flags** — position_id or compensation_id, doc_type
  expected, status (missing / requested / received), notes.

## Release plan

### v0.1.0 — Foundation
- Electron + React + TypeScript + SQLite scaffold, matching Inkwell/IDP
  Manager conventions (main/preload/renderer split, `sandbox: true`).
- Core tables: Companies, Positions, Compensation (cash only), Instrument
  Types (seeded list, editable).
- Basic CRUD UI: add/edit/list companies (incl. board size, other board
  members, meeting cadence) and positions (incl. expected decision date for
  potential positions), dashboard view (current / former / potential
  counts, upcoming decision dates).
- Import company + business-summary seed data from the existing spreadsheet.
- Packaged, signed (Dunkin Global Advisors self-signed cert, same as other
  apps) Windows NSIS installer.
- Functionality + boundary + security test suite (SQL injection, XSS,
  path traversal on file links, input-size boundaries).
- GitHub Actions CI build on `windows-latest`, tagged `v0.1.0` release.

### v0.2.0 — Non-cash compensation & vesting (Delivered)
- Compensation table extended to non-cash: instrument type, quantity,
  grant/strike price.
- Vesting Schedules table + UI: cliff/linear, milestone, custom types.
- Vesting summary view per position (e.g. "% vested to date").
- Migration from v0.1.0 DB (idempotent, versioned, CC Benefit Tracker style).
- Expanded test suite for new tables/boundaries.
- `v0.2.0` release.

### v0.3.0 — Document linking (Delivered)
- Documents table + UI: link a document to a company/position, pick
  doc_type, open via system default handler.
- Missing Document Flags: manually flag/track expected-but-absent documents
  (e.g. "confirmation of shares issued") per position/compensation record.
- Broken-link detection (flag when a linked file no longer resolves).
- `v0.3.0` release.

### v0.4.0 — Perplexity-assisted document import (Delivered)
- "Import Extracted Data" screen: load a structured JSON file (produced in a
  Perplexity session from an uploaded agreement) and map it into
  Compensation / Vesting / Documents / Missing Document Flags records, with
  a review-before-commit step so nothing is silently overwritten.
- Define and document the JSON import schema so future extraction sessions
  produce compatible files.
- Raw extraction payload stored alongside the record for audit trail.
- `v0.4.0` release.

### v0.4.1 — Import ergonomics (Delivered)
- Copy-extraction-prompt button and a paste-JSON box, so an import no longer
  requires saving a file first.

### v0.4.2 — Import robustness (Delivered)
- Report every problem in a file at once, with the JSON path and the offending
  value, instead of failing on the first one.
- Accept synonym field names and a single-element vesting array, reporting each
  rename rather than applying it silently. Renames never reinterpret a value.
- Keep fields the schema does not track in the record's audit payload and list
  them in the review panel, instead of dropping them without a word.
- Publish `docs/board-tracker.import.schema.json` and a Save schema file button
  so the schema can be attached to the extraction session.

### v0.5.0+ — Polish & reporting
- Reporting views: compensation summary across all positions, upcoming
  vesting events, missing-document report.
- Export to Excel/CSV (matching Address Book/Vault export patterns).
- Theming pass, UX refinement based on usage feedback.
- `v0.5.0` release, then iterate per your feedback.

## Conventions carried over from your other apps

- Electron Builder → NSIS installer, `--win --x64 --publish never`.
- `better-sqlite3`, unpacked from asar for native module support.
- Self-signed Dunkin Global Advisors code-signing cert (RSA-4096,
  DigiCert timestamp) — Windows will still show "unknown publisher,"
  as with your other apps.
- Semver git tags (`v0.1.0`, `v0.2.0`, ...) with CHANGELOG.md, GitHub
  Actions building on `windows-latest`.
- Separate functionality / security / boundary test suites per release.
- `sandbox: true`, context-bridge IPC, main process owns all filesystem/DB
  access — no direct renderer file access.

## Confirmed field additions

- Companies: board_size, other_board_members, meeting_cadence.
- Positions: expected_decision_date (used for potential positions).
