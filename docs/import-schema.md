# Board Tracker import schema (v1)

Board Tracker never calls an AI service. Extraction happens in a **Perplexity session**: you upload an
agreement there, ask for a Board Tracker import file, save the JSON it produces, then load that file
from **Import extracted data** in the app. Nothing is written until you review the plan and confirm.

This document is the contract. A file that follows it will import cleanly; a file that does not is
rejected with the exact JSON path of the problem (for example
`file.companies[0].positions[1].compensation[0].frequency: must be one of: one_time, annual, ...`).

---

## File shape

```jsonc
{
  "schema": "board-tracker.import",   // required, exact string
  "schema_version": 1,                // required; this app supports up to 1
  "generated_at": "2026-08-09",       // optional YYYY-MM-DD
  "source": {                         // optional provenance, stored with the audit record
    "tool": "Perplexity",
    "reference": "https://www.perplexity.ai/search/...",
    "notes": "Extracted from autobridge-advisor-agreement.pdf"
  },
  "companies": [ /* 1–500 company objects */ ]
}
```

Records are **nested**, and nesting is what creates the links between them. A document inside a
`compensation` object is attached to that grant; a document inside a `position` is attached to that
position; a document at the company level is a company-wide document. There are no id fields
anywhere — any `id` you include is ignored, and records are matched by their content (see
[Matching rules](#matching-rules)).

### `companies[]`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string, required | ≤ 200 chars. The match key. Must be unique within the file (case-insensitive). |
| `fields` | object, optional | Company profile fields. Only used to **fill blanks**; differing values become conflicts. |
| `positions` | array, optional | ≤ 200 entries. |
| `documents` | array, optional | ≤ 200 entries. Company-level documents. |

`fields` accepts `business_summary` (≤ 10000), `sector` (≤ 150), `website` (≤ 2048),
`board_size` (whole number 0–100000), `other_board_members` (≤ 5000), `meeting_cadence` (≤ 100),
and `notes` (≤ 10000). Unknown keys are ignored.

### `positions[]`

| Field | Type | Notes |
| --- | --- | --- |
| `status` | required | `current`, `former`, or `potential` |
| `position_type` | required | `governing_board`, `advisory_board`, or `advisor` |
| `start_date` | date, optional | `YYYY-MM-DD`. **Include it** — it is what disambiguates repeat positions at the same company. |
| `end_date` | date, optional | Must not be before `start_date`. |
| `expected_decision_date` | date, optional | Only kept when `status` is `potential`. |
| `notes` | string, optional | ≤ 10000 chars. |
| `compensation` | array, optional | ≤ 200 entries. |
| `documents` | array, optional | ≤ 200 entries. Documents about the position itself. |

### `compensation[]`

`type` is `cash` or `non_cash` (default `cash`), and it decides which other fields are required.

**Cash** — `amount` (required number > 0), `currency` (three-letter ISO code, defaults to `USD`,
case-insensitive), `frequency` (required: `one_time`, `annual`, `quarterly`, `monthly`, `per_meeting`).

**Non-cash** — `instrument_type` (required string, e.g. `Options`, `RSU`, `Stock`, `Warrant`,
`Profits Interest`; matched case-insensitively and **created if it does not exist**), `quantity`
(required number > 0), `grant_price` (optional number ≥ 0), `grant_date` (optional date).

Both accept `notes`, `documents`, and `extracted_data`. Only non-cash accepts `vesting`.

### `vesting`

A single object, not an array — it is the schedule for the grant it sits inside.

| Field | Type | Notes |
| --- | --- | --- |
| `schedule_type` | required | `immediate`, `cliff_linear`, `milestone`, or `custom` |
| `vesting_start`, `cliff_date`, `vesting_end` | date, optional | `YYYY-MM-DD` |
| `cadence` | optional | `monthly`, `quarterly`, `annual`, or `one_time` |
| `notes` | string, optional | ≤ 10000 chars |

Percentage-vested figures on the dashboard are calculated from `cliff_linear` schedules that have
both `vesting_start` and `vesting_end`.

### `documents[]`

| Field | Type | Notes |
| --- | --- | --- |
| `document_type` | string, required | ≤ 100 chars. Free text; the app's own list is `board_agreement`, `offer_letter`, `grant_agreement`, `nda`, `confirmation_of_shares`. |
| `status` | required | `linked` or `missing` (defaults to `missing`) |
| `file_path` | string | **Required when `linked`, forbidden when `missing`.** An absolute path on this machine. |
| `file_name` | string, optional | Derived from `file_path` when omitted. |
| `description` | string, optional | ≤ 10000 chars |
| `document_date` | date, optional | `YYYY-MM-DD` |

Use `status: "missing"` to record a **missing-document flag** — an agreement referenced an exhibit or
a share confirmation that you were not given. Those appear on the Overview page, and a later import
that supplies the real `file_path` will attach it to the same flag rather than creating a duplicate.

Board Tracker **links** documents; it never copies, moves, or deletes the original file.

### `extracted_data`

Any object or array, allowed on `compensation` and `documents`, ≤ 200,000 characters serialized.
It is stored verbatim next to the record as the audit trail — put the clause number, the quoted
text, and a confidence marker here so a value can always be traced back to the agreement:

```json
"extracted_data": { "clause": "3(a)", "confidence": "high", "quoted_text": "25,000 options at $1.25" }
```

The complete file is also stored on the import batch, so the exact bytes you imported can be
recovered later even if the records are edited afterwards.

---

## Matching rules

Nothing is matched by id, and **nothing is silently overwritten**.

| Record | Matched by |
| --- | --- |
| Company | `name`, case-insensitive |
| Position | `position_type` + `status` within the company, then `start_date` when supplied |
| Instrument type | `name`, case-insensitive |
| Cash compensation | `amount` + `currency` + `frequency` within the position |
| Non-cash compensation | instrument type + `quantity` + `grant_date` within the position |
| Vesting | the most recent schedule on that grant |
| Document | `document_type` + the same company/position/grant link, preferring the same `file_path`, then a `missing` flag |

Each matched or unmatched record becomes one reviewable row in the plan:

- **New** — no match found; the record will be created. Selected by default.
- **Fill in** — matched, and the file supplies values for fields that are currently empty. Selected by default.
- **Conflict** — matched, but a value in the file differs from a non-empty value you already have.
  **Off by default**; the before and after values are shown, and it applies only if you tick it.
- **Already there** — matched and identical. Nothing to do.
- **Blocked** — cannot proceed. Either its parent was not imported, or the match was ambiguous (two
  positions of the same type and status with no `start_date` to tell them apart). Fix the file or the
  data and re-import.

Turning off a parent row blocks everything beneath it, so a company you deselect brings none of its
positions, grants, or documents with it.

Imports are **idempotent**: running the same file twice produces all "Already there" rows and changes
nothing. Each committed file is written in a single transaction — if any part fails, none of it lands.

---

## Limits

| Limit | Value |
| --- | --- |
| File size | 5 MB |
| Companies per file | 500 |
| Positions / compensation / documents per parent | 200 |
| `extracted_data` per record | 200,000 characters serialized |

Text is trimmed and control characters are stripped on the way in.

---

## Prompt to use in a Perplexity session

> Read the attached board or advisory agreement and produce a Board Tracker import file. Output only
> JSON matching the `board-tracker.import` schema version 1: a top-level object with `schema`,
> `schema_version`, `generated_at`, `source`, and `companies`. Nest positions inside the company,
> compensation inside the position, and vesting and documents inside the compensation they belong to.
> Use `YYYY-MM-DD` for every date. Include `start_date` on each position. For every compensation and
> document record add an `extracted_data` object with the clause number, the quoted source text, and a
> confidence marker. Set `status: "linked"` with the absolute `file_path` for documents I have, and
> `status: "missing"` with a description for any document the agreement references but does not
> include. Do not invent values — omit a field rather than guessing it.

See [`import-example.json`](./import-example.json) for a complete worked file.
