import { cadences, compensationTypes, documentStatuses, frequencies, positionStatuses, positionTypes, scheduleTypes } from './import-constants';

const str = (description: string, maxLength?: number) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) });
const nullableStr = (description: string, maxLength?: number) => ({ type: ['string', 'null'], description, ...(maxLength ? { maxLength } : {}) });
const isoDate = (description: string) => ({ type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: `${description} Format YYYY-MM-DD.` });
const enumOf = (values: string[], description: string) => ({ type: 'string', enum: values, description });

const document = {
  type: 'object',
  additionalProperties: true,
  required: ['document_type', 'status'],
  description: 'A document referenced by the agreement. Use status "missing" for anything you cannot supply a real local file path for.',
  properties: {
    document_type: str('Short kind of document, e.g. "Advisory agreement", "Stock option agreement", "Board approval".', 100),
    status: enumOf(documentStatuses, 'Use "linked" only with a real path on the user\'s own machine. Otherwise "missing".'),
    file_path: nullableStr('Absolute path on the user\'s machine. Required when status is "linked", and must be omitted when status is "missing". Never invent a path.', 32767),
    file_name: nullableStr('Display name. Derived from file_path when omitted.', 1024),
    description: nullableStr('What the document is and anything notable about it.', 10000),
    document_date: isoDate('Date on the document itself.'),
    extracted_data: { type: ['object', 'array', 'null'], description: 'Any extra structured detail worth keeping. Retained verbatim for the audit trail.' },
  },
};

const vesting = {
  type: 'object',
  additionalProperties: true,
  required: ['schedule_type'],
  description: 'A single vesting schedule object — not an array. A one-year cliff followed by monthly vesting is schedule_type "cliff_linear" with cadence "monthly".',
  properties: {
    schedule_type: enumOf(scheduleTypes, 'Pick the closest listed value. A cliff followed by periodic vesting is "cliff_linear".'),
    vesting_start: isoDate('The vesting commencement date. Required for any percent-vested calculation to work.'),
    cliff_date: isoDate('Date the cliff portion vests.'),
    vesting_end: isoDate('Date the grant is fully vested.'),
    cadence: { type: ['string', 'null'], enum: [...cadences, null], description: 'How often the post-cliff portion vests.' },
    notes: nullableStr('Cliff fraction, per-period fraction, total term, forfeiture and acceleration terms, and any conditions.', 10000),
  },
};

const compensation = {
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  description: 'One compensation element. Cash retainers and equity grants are separate entries.',
  properties: {
    type: enumOf(compensationTypes, 'Use "non_cash" for options, RSUs, warrants and other equity.'),
    amount: { type: ['number', 'null'], exclusiveMinimum: 0, description: 'Required when type is "cash".' },
    currency: nullableStr('Three-letter ISO code. Defaults to USD.', 3),
    frequency: { type: ['string', 'null'], enum: [...frequencies, null], description: 'Required when type is "cash".' },
    instrument_type: nullableStr('Required when type is "non_cash", e.g. "Non-Statutory Stock Option".', 100),
    quantity: { type: ['number', 'null'], exclusiveMinimum: 0, description: 'Required when type is "non_cash". The number of units granted.' },
    grant_price: { type: ['number', 'null'], minimum: 0, description: 'Per-unit exercise or strike price. Use the actual number, e.g. 0.07.' },
    grant_date: isoDate('Date of grant.'),
    notes: nullableStr('Anything about this element that has no field of its own.', 10000),
    vesting,
    documents: { type: 'array', maxItems: 200, items: document },
    extracted_data: { type: ['object', 'array', 'null'], description: 'Extra structured detail kept verbatim for the audit trail.' },
  },
};

const position = {
  type: 'object',
  additionalProperties: true,
  required: ['status', 'position_type'],
  properties: {
    status: enumOf(positionStatuses, 'Whether the person holds this seat now, held it before, or is considering it.'),
    position_type: enumOf(positionTypes, 'A fiduciary seat is "governing_board"; an advisory board seat is "advisory_board".'),
    start_date: isoDate('Date the appointment began or begins.'),
    end_date: isoDate('Date it ended. Omit for current positions.'),
    expected_decision_date: isoDate('Only meaningful when status is "potential".'),
    notes: nullableStr('Title, term, time commitment, expense policy and any other terms.', 10000),
    compensation: { type: 'array', maxItems: 200, items: compensation },
    documents: { type: 'array', maxItems: 200, items: document },
  },
};

const company = {
  type: 'object',
  additionalProperties: true,
  required: ['name'],
  properties: {
    name: str('Legal entity name. Matched case-insensitively against existing companies.', 200),
    fields: {
      type: 'object',
      additionalProperties: true,
      description: 'Company profile. Anything here that is not a listed property is kept in notes rather than discarded.',
      properties: {
        business_summary: nullableStr('What the company does.', 10000),
        sector: nullableStr('Industry or sector.', 150),
        website: nullableStr('Primary URL.', 2048),
        board_size: { type: ['integer', 'null'], minimum: 0, maximum: 100000 },
        other_board_members: nullableStr('Other directors or advisors, comma separated.', 5000),
        meeting_cadence: nullableStr('How often the board meets.', 100),
        notes: nullableStr('Entity type, d/b/a, address, contacts, governing law and anything else.', 10000),
      },
    },
    positions: { type: 'array', maxItems: 200, items: position },
    documents: { type: 'array', maxItems: 200, items: document },
  },
};

/**
 * The published contract for extraction output. Attach this file to the session that reads the
 * agreement so the model emits these exact field names instead of plausible-looking synonyms.
 */
export const IMPORT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/anndunkin/board-tracker/blob/main/docs/board-tracker.import.schema.json',
  title: 'Board Tracker import file',
  description: 'Board positions, compensation, vesting and documents extracted from an agreement. Emit exactly this shape. Use null for anything the source does not state — never guess. Values not covered by a listed property are preserved rather than dropped, but they are easier to use when they land in the right field.',
  type: 'object',
  additionalProperties: true,
  required: ['schema', 'schema_version', 'companies'],
  properties: {
    schema: { const: 'board-tracker.import' },
    schema_version: { const: 1 },
    generated_at: isoDate('Date the extraction was produced.'),
    source: {
      type: 'object',
      additionalProperties: true,
      properties: {
        tool: nullableStr('What produced the file, e.g. "Perplexity".', 200),
        reference: nullableStr('Link back to the session or source material.', 2048),
        notes: nullableStr('Anything about how the extraction was done.', 10000),
      },
    },
    companies: { type: 'array', minItems: 1, maxItems: 500, items: company },
  },
} as const;

export const IMPORT_JSON_SCHEMA_FILENAME = 'board-tracker.import.schema.json';
export const importJsonSchemaText = (): string => `${JSON.stringify(IMPORT_JSON_SCHEMA, null, 2)}\n`;
