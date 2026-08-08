# Board Tracker

A Windows desktop app for tracking current, past, and potential board and
advisory positions — companies, position status and type, cash and
non-cash compensation (with configurable equity instruments and vesting
schedules), linked agreement/document files, and missing-document tracking.

Built with Electron + React + TypeScript + SQLite (`better-sqlite3`),
following the same conventions as [Address Book](https://github.com/anndunkin/address-book),
[Inkwell](https://github.com/anndunkin/inkwell), and
[IDP Manager](https://github.com/anndunkin/idp-manager).

See [RELEASE_PLAN.md](./RELEASE_PLAN.md) for the phased delivery plan across
releases.

## Status

Pre-release. Currently in planning (targeting v0.1.0).

## Documents

Documents (board agreements, stock grants, share confirmations, etc.) are
**linked, not copied** — the app stores a reference to the file's existing
location and opens it with your system's default handler. Structured data
extraction from documents is Perplexity-assisted: the app itself never
calls an external AI API. See RELEASE_PLAN.md for the v0.4.0 import
workflow.

## License

Private use — Dunkin Global Advisors.
