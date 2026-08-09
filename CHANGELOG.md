# Changelog

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
