import { IMPORT_SCHEMA_ID, IMPORT_SCHEMA_VERSION } from './import-constants';

/**
 * The prompt behind the "Research this company" button. Board Tracker makes no network calls of its
 * own, so the research happens in a Perplexity session and comes back as an ordinary import file —
 * the same parser, the same review-before-commit screen, the same audit trail as an agreement
 * extraction. The only difference is that the file carries company profile fields and no positions.
 *
 * The result is deliberately narrow: profile fields only. Anything about your own seat — start
 * dates, compensation, vesting — is private and could not be researched anyway, so the prompt tells
 * the model not to invent it.
 */
export function companyResearchPrompt(name: string, website?: string | null): string {
  const known = website?.trim() ? ` Its website is ${website.trim()}.` : '';
  return `Research the company "${name}" and produce a Board Tracker import file describing it.${known}

Follow the attached \`board-tracker.import.schema.json\` exactly, including its field names. Output only JSON matching the \`${IMPORT_SCHEMA_ID}\` schema version ${IMPORT_SCHEMA_VERSION}: a top-level object with \`schema\`, \`schema_version\`, \`generated_at\`, \`source\`, and \`companies\`, containing exactly one company.

Set \`name\` to the company's full legal name if you can establish it, and give \`fields\` these entries where you can support them:
- \`business_summary\`: two or three sentences on what the company actually sells and to whom. Plain description, no marketing language.
- \`sector\`: a short industry label, a few words at most.
- \`website\`: the primary domain.
- \`board_size\`: the number of directors, only if you can count them from a named source.
- \`other_board_members\`: the directors and their affiliations, one per line, excluding me.

Rules that matter more than completeness:
- Do not guess. Omit any field you cannot support with a source. An absent field is fine; a plausible invention is not.
- Do not write anything about my own board seat, compensation, vesting, or documents. Return no \`positions\` array.
- Put your sourcing in the company's \`extracted_data\` object: a \`sources\` array of {url, title} for what you used, a \`confidence\` marker, and a \`researched_on\` date. Anything interesting that the schema has no field for can go in \`extracted_data\` too — Board Tracker keeps it and shows it to me rather than discarding it.
- If the name is ambiguous and several companies could match, say so in \`source.notes\` and describe the one you chose.`;
}
