# Changelog

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
