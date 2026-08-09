# Changelog

## [0.5.0] — 2026-08-09

Two changes that turn out to be one change. Renaming a company was impossible without breaking
future imports, because imports match on name — so the moment you recorded a DBA, the next
extraction of the same agreement would create a second company beside the first. Renaming is now
free because the app remembers what the company used to be called.

### Added
- **Companies can be renamed.** Editing the name records the previous one as a former name, shown
  under **Also known as** on the company record. Imports match on former names as well as the
  current one, so a file written against `ArmorX.ai` updates the company now called
  `Kapalya, Inc. dba ArmorX.ai` instead of duplicating it — and the plan row says which former name
  it matched on, rather than matching quietly. You can add a former name by hand (for an
  abbreviation an older file used) or remove one. The edit dialog warns you what will be remembered
  before you save.
- **Research this company.** A button on the company record copies a prompt that fills in the
  profile fields — business summary, sector, website, board size, other directors — by researching
  the company in a Perplexity session. The result comes back as an ordinary import file through the
  same review-before-commit screen, so nothing is written without your approval, and the prompt
  requires a source for every field and forbids guessing. It asks for company facts only: nothing
  about your seat, pay, or vesting is sent anywhere.

### Notes
- Board Tracker still makes **no network calls of its own**. Research happens in your browser
  session; the app only reads the JSON you bring back.
- A name cannot be a former name of one company and the current name of another. Both directions are
  rejected with the conflicting company named, rather than resolved by guessing.
- Renaming a company back to an earlier name drops that name from the list and remembers the one
  just abandoned instead, so the list never contains the name the company currently holds.
- Schema migration 8 adds the `company_aliases` table. Existing databases migrate on first launch;
  no data is rewritten.

## [0.4.2] — 2026-08-09

Prompted by a real extraction that the v0.4.1 importer rejected four times in a row, each time
naming only one problem, and which — once it finally parsed — would have silently discarded about
thirty fields including the vesting start date the dashboard's percent-vested figure is computed
from. The principle this release settles on: **strict on meaning, forgiving on naming, never silent.**

### Added
- **Every problem in a file is reported at once**, as a numbered list with the JSON path and the
  offending value for each (`positions[0].status: must be one of: current, former, potential. Found
  "nope".`). Fixing an extraction no longer means one blind edit per reload. Very long lists are
  capped at 25 shown.
- **Field names that are obviously synonyms are accepted and reported**, never applied silently:
  `company_name`, `position_status`, `role_type`, `compensation_type`, `instrument`, `shares`,
  `exercise_price`, `vesting_type`, `commencement_date`, `post_cliff_period`, and others. A
  single-element `vesting` array is read as the one object it contains. Company profile fields
  written at the top level are moved into `fields`. Aliases rename keys only — they never
  reinterpret a value, so a `vesting_type` of `cliff_then_monthly` is still an error, correctly.
- **Fields the schema does not track are kept, not dropped.** They are stored in the record's
  `extracted_data` audit payload under `unmapped_fields` and listed in the review panel with their
  values before you commit. Your own notes are never written to by an import.
- **A machine-readable JSON Schema** (`docs/board-tracker.import.schema.json`, draft 2020-12) and a
  **Save schema file…** button that writes it to disk, so it can be attached to the extraction
  session alongside the agreement. The schema is generated from the same constants the parser
  validates against and a test asserts the checked-in file matches, so the two cannot drift.

### Changed
- Companies, positions, and vesting schedules gained an `extracted_data_json` column (migration 7),
  matching the one compensation and documents already had.
- The extraction prompt now tells the model to follow the attached schema file exactly and that
  `vesting` is a single object requiring `vesting_start`.

### Notes
- The importer will not infer a value it was not given. An extraction that supplies a 409A
  reference valuation but no exercise price leaves `grant_price` empty for you to fill in, with the
  reference number preserved and shown; one that gives a vesting duration in months but no
  `vesting_end` leaves the percentage uncalculable. Both are visible in the review panel rather
  than guessed.

## [0.4.1] — 2026-08-09

### Added
- **Copy extraction prompt** button on the import screen. It puts the documented extraction prompt on your clipboard so you can paste it straight into a Perplexity session with the agreement, instead of digging it out of `docs/import-schema.md`. A test asserts the button and the docs carry identical text, so they cannot drift apart.
- **Paste JSON** box, so an import no longer requires saving a file first. Pasted text goes through exactly the same parser, review plan, and commit path as a picked file; only the source label differs. A surrounding ```` ```json ```` code fence is stripped automatically, since that is how the JSON usually arrives.

### Fixed
- Import screen cards had no inner padding, leaving their contents flush against the card edge. They now match the padding used elsewhere in the app.
- A failed parse left an empty "Review before commit" card on screen below the error. The review card is now hidden until there is a plan to show.
- Parse errors said "the import file" even when the content had been pasted, and did not say what to do. The wording is now source-aware and explains that the JSON object is wanted, not the surrounding chat reply.

## [0.4.0] — 2026-08-09

### Added
- "Import extracted data" screen that loads a structured JSON file produced in a Perplexity session from an uploaded agreement and maps it into company, position, compensation, vesting, document, and missing-document records. Board Tracker still makes no network calls of its own — it only reads the file you pick.
- Review-before-commit workflow: every record in the file becomes a reviewable row marked New, Fill in, Conflict, Already there, or Blocked, with per-row checkboxes and the before and after values for each field. The preview runs the real import inside a transaction that is rolled back, so what you review is exactly what commits.
- No-silent-overwrite matching. Records are matched by content rather than id (company by name, position by type/status/start date, compensation by its identifying amounts, documents by type and link). Anything that would replace an existing non-empty value is classed as a conflict and is off by default; deselecting a parent blocks its whole subtree, and ambiguous matches are blocked rather than guessed.
- Idempotent imports: re-importing the same file reports everything as already there and changes no rows. An extracted file that supplies a path for an existing missing-document flag attaches to that same flag instead of creating a duplicate.
- Audit trail. Every committed file is recorded as an import batch with its provenance, summary counts, and the complete raw payload, and each imported compensation and document record keeps its own `extracted_data` payload and a reference back to the batch.
- Documented JSON import schema (`docs/import-schema.md`) with limits, matching rules, a suggested extraction prompt, and a worked example file (`docs/import-example.json`) that is verified by the test suite.
- Versioned migration for the `import_batches` table and the `extracted_data_json` and `import_batch_id` columns on documents and compensation.
- 47 new import tests covering end-to-end mapping, review-before-commit behavior, malformed and oversized input, and security (SQL injection, XSS, prototype pollution, caller-supplied ids, and partial-failure rollback).

## [0.3.0] — 2026-08-08

### Added
- Linked document records for company-level, position-specific, and compensation-specific agreements, with safe file selection and opening through the operating system's default application. Files remain in their original locations and are never copied or deleted by Board Tracker.
- Editable document metadata, including a curated common-type menu with custom types, display names, descriptions, and document dates.
- Missing-document placeholders that can later be updated in place to attach the received file, plus an overview list sorted by company and prominent attach-file actions in company records.
- Broken-link recovery actions that let you re-link a moved file or mark the record as missing.
- Versioned migration for document references, including company-delete cascade and retained document metadata when a linked position or compensation record is removed.

## [0.2.1] — 2026-08-08

### Fixed
- Non-cash compensation could not be saved when the default vesting schedule type ("Immediate") was selected. The form submitted empty strings for cliff date, vesting start, vesting end, and cadence fields that are intentionally hidden for that schedule type, and the backend validator rejected an empty string as an invalid cadence value — blocking every non-cash save by default. The form now sends `null` for fields it doesn't render, and the validator now also normalizes an empty string to `null` for defense in depth. Added a regression test covering this exact form-submission shape.

## [0.2.0] — 2026-08-08

### Added
- Non-cash compensation records with configurable instrument types, quantities, optional grant or strike prices, and grant dates.
- Fully managed instrument types with create, edit, and safe delete behavior that blocks removal while a type is referenced by compensation.
- Versioned migration from v0.1.0 cash compensation to the new cash/non-cash schema, preserving existing records.
- Vesting schedules for immediate, cliff and linear, milestone, and custom awards, including inline compensation editing.
- Vesting summaries on company compensation entries and an active-vesting dashboard section ordered by soonest vesting end date.
- Expanded migration, functionality, security, boundary, and vesting-calculation test coverage.

## [0.1.0] — 2026-08-08

### Added
- Secure Electron + React + TypeScript foundation with an unencrypted SQLite database exclusively owned by the main process.
- Versioned, idempotent schema migrations for companies, positions, cash-only compensation, and future-use instrument types.
- Dashboard, searchable companies directory, company detail flow, plus CRUD forms for companies, positions, and cash compensation.
- Idempotent seed-company import on first startup and through the File menu.
- Light/dark interface theme and explicit confirmation prompts for destructive actions.
- Functionality, security, and boundary test suites.
