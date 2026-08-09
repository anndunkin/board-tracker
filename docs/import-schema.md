# Board Tracker import schema (v1)

Board Tracker never calls an AI service. Extraction happens in a **Perplexity session**: you upload an
agreement there, ask for a Board Tracker import file, then bring the JSON it produces into
**Import extracted data** in the app — either paste it straight into the paste box or save it as a
`.json` file and pick it. Nothing is written until you review the plan and confirm.

The **Copy extraction prompt** button on that screen puts the prompt below on your clipboard, so you
do not have to come back to this file for it. When pasting, a surrounding ```` ```json ```` fence is
stripped for you; anything else around the JSON object is not.

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
| `duration_months` | integer, optional | Total vesting term in months, 1–600. Aliases: `total_vesting_months`, `vesting_months`, `total_months`, `vesting_term_months` |
| `cadence` | optional | `monthly`, `quarterly`, `annual`, or `one_time` |
| `notes` | string, optional | ≤ 10000 chars |

Percentage-vested figures on the dashboard are calculated from `cliff_linear` schedules that have
`vesting_start` plus either `vesting_end` or `duration_months`. Many agreements state a term
("vesting over 48 months") and never name a completion date, so send `duration_months` in that case
and Board Tracker works the end date out from the vesting start. If a file gives both, the stated
`vesting_end` wins and the app shows what the agreement says. Derived dates are marked in the app.

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
| Company | `name`, case-insensitive; then any name the company was previously known by |
| Position | `position_type` + `status` within the company, then `start_date` when supplied |
| Instrument type | `name`, case-insensitive |
| Cash compensation | `amount` + `currency` + `frequency` within the position |
| Non-cash compensation | instrument type + `quantity` + `grant_date` within the position |
| Vesting | the most recent schedule on that grant |
| Document | `document_type` + the same company/position/grant link, preferring the same `file_path`, then a `missing` flag |

When a company is renamed in Board Tracker, the name it left behind is remembered and keeps matching
imports. A file written against `ArmorX.ai` still updates the company now called
`Kapalya, Inc. dba ArmorX.ai` rather than creating a second record, and the plan row says so by
name. Former names are listed under **Also known as** on the company record, where you can add one
by hand or remove one. A name cannot be a former name of one company and the current name of
another; either direction is rejected rather than guessed at.

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

This is the exact text behind the **Copy extraction prompt** button; a test keeps the two identical.

> Read the attached board or advisory agreement and produce a Board Tracker import file. Follow the
> attached `board-tracker.import.schema.json` exactly, including its field names — a synonym that
> looks equivalent is not equivalent. Output only JSON matching the `board-tracker.import` schema
> version 1: a top-level object with `schema`, `schema_version`, `generated_at`, `source`, and
> `companies`. Nest positions inside the company, compensation inside the position, and vesting and
> documents inside the compensation they belong to. Use `YYYY-MM-DD` for every date. Include
> `start_date` on each position. `vesting` is a single object, not an array, and needs
> `vesting_start` set to the vesting commencement date. Give `vesting_end` when the agreement
> states a completion date and `duration_months` when it states a term instead ("vesting over 48
> months" is 48); send both if it gives both. For every compensation and document record
> add an `extracted_data` object with the clause number, the quoted source text, and a confidence
> marker. Set `status: "linked"` with the absolute `file_path` for documents I have, and `status:
> "missing"` with a description for any document the agreement references but does not include. Do
> not invent values — omit a field rather than guessing it.

See [`import-example.json`](./import-example.json) for a complete worked file.

## Prompt behind "Research this company"

Board Tracker makes no network calls, so the **Research this company** button on a company record
copies a prompt instead of fetching anything. Run it in a Perplexity session, attach the schema
file, and paste the JSON back into **Import extracted data** — it goes through the same
review-before-commit screen as an agreement extraction. The prompt asks for company profile fields
only; nothing about your own seat, pay, or vesting is researched or requested. The company name and
website are substituted from the record, and the "Its website is …" sentence is omitted when no
website is on file.

> Research the company "{name}" and produce a Board Tracker import file describing it. Its website
> is {website}.
>
> Follow the attached `board-tracker.import.schema.json` exactly, including its field names. Output
> only JSON matching the `board-tracker.import` schema version 1: a top-level object with `schema`,
> `schema_version`, `generated_at`, `source`, and `companies`, containing exactly one company.
>
> Set `name` to the company's full legal name if you can establish it, and give `fields` these
> entries where you can support them:
> - `business_summary`: two or three sentences on what the company actually sells and to whom.
>   Plain description, no marketing language.
> - `sector`: a short industry label, a few words at most.
> - `website`: the primary domain.
> - `board_size`: the number of directors, only if you can count them from a named source.
> - `other_board_members`: the directors and their affiliations, one per line, excluding me.
>
> Rules that matter more than completeness:
> - Do not guess. Omit any field you cannot support with a source. An absent field is fine; a
>   plausible invention is not.
> - Do not write anything about my own board seat, compensation, vesting, or documents. Return no
>   `positions` array.
> - Put your sourcing in the company's `extracted_data` object: a `sources` array of {url, title}
>   for what you used, a `confidence` marker, and a `researched_on` date. Anything interesting that
>   the schema has no field for can go in `extracted_data` too — Board Tracker keeps it and shows it
>   to me rather than discarding it.
> - If the name is ambiguous and several companies could match, say so in `source.notes` and
>   describe the one you chose.
