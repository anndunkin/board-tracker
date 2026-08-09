import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { companyInput, testDatabase } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
import type { ImportPlan } from '../src/shared/types';
import { companyResearchPrompt } from '../src/shared/research-prompt';
import { IMPORT_SCHEMA_ID, IMPORT_SCHEMA_VERSION } from '../src/shared/import-constants';

let db: BoardTrackerDatabase; let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());

const commit = (payload: unknown): ImportPlan => db.commitExtractedImport(JSON.stringify(payload), 'extraction.json', {});
const fileNamed = (name: string) => ({ schema: IMPORT_SCHEMA_ID, schema_version: IMPORT_SCHEMA_VERSION, generated_at: '2026-08-09', companies: [{ name, fields: { sector: 'Automotive software' } }] });

describe('rename: a company keeps the names it used to have', () => {
  it('remembers the previous name when a company is renamed', () => {
    const company = db.createCompany(companyInput('ArmorX.ai'));
    db.updateCompany(company.id, companyInput('Kapalya, Inc. dba ArmorX.ai'));
    const detail = db.getCompany(company.id);
    expect(detail?.name).toBe('Kapalya, Inc. dba ArmorX.ai');
    expect(detail?.aliases.map((alias) => [alias.name, alias.source])).toEqual([['ArmorX.ai', 'rename']]);
  });

  it('does not record an alias when the edit leaves the name alone', () => {
    const company = db.createCompany(companyInput('AutoBridge Systems'));
    db.updateCompany(company.id, { ...companyInput('AutoBridge Systems'), sector: 'Fleet telematics' });
    expect(db.getCompany(company.id)?.aliases).toEqual([]);
  });

  it('treats a case-only change as a correction rather than a rename', () => {
    const company = db.createCompany(companyInput('crowdgenai'));
    db.updateCompany(company.id, companyInput('CrowdGenAI'));
    const detail = db.getCompany(company.id);
    expect(detail?.name).toBe('CrowdGenAI');
    expect(detail?.aliases).toEqual([]);
  });

  it('never remembers a name the company currently holds', () => {
    const company = db.createCompany(companyInput('Bowtie Security'));
    db.updateCompany(company.id, companyInput('Bowtie Sec'));
    expect(db.getCompany(company.id)?.aliases.map((alias) => alias.name)).toEqual(['Bowtie Security']);
    db.updateCompany(company.id, companyInput('Bowtie Security'));
    // Renaming back drops the stale alias and remembers the name just abandoned instead.
    expect(db.getCompany(company.id)?.aliases.map((alias) => alias.name)).toEqual(['Bowtie Sec']);
  });

  it('refuses a new name that another company is remembered by', () => {
    const first = db.createCompany(companyInput('Open Origin'));
    db.updateCompany(first.id, companyInput('Open Origin Materials'));
    const second = db.createCompany(companyInput('Open Policy'));
    expect(() => db.updateCompany(second.id, companyInput('Open Origin'))).toThrow(/Open Origin Materials/);
  });

  it('refuses a manual alias that collides with a live company name', () => {
    db.createCompany(companyInput('SuperAlign'));
    const other = db.createCompany(companyInput('RiskOpsAI'));
    expect(() => db.addCompanyAlias(other.id, 'SuperAlign')).toThrow(/SuperAlign/);
    expect(() => db.addCompanyAlias(other.id, 'RiskOpsAI')).toThrow();
    expect(() => db.addCompanyAlias(other.id, '   ')).toThrow();
  });

  it('adds and removes a manual alias', () => {
    const company = db.createCompany(companyInput('Global Interconnection Group'));
    const alias = db.addCompanyAlias(company.id, 'GIG');
    expect(alias.source).toBe('manual');
    expect(db.getCompany(company.id)?.aliases.map((entry) => entry.name)).toEqual(['GIG']);
    db.deleteCompanyAlias(alias.id);
    expect(db.getCompany(company.id)?.aliases).toEqual([]);
  });
});

describe('rename: imports written before a rename still match', () => {
  it('updates the renamed company instead of creating a duplicate', () => {
    commit(fileNamed('ArmorX.ai'));
    const [company] = db.listCompanies();
    db.updateCompany(company.id, companyInput('Kapalya, Inc. dba ArmorX.ai'));

    const plan = commit(fileNamed('ArmorX.ai'));
    expect(db.listCompanies()).toHaveLength(1);
    const matched = plan.operations.find((entry) => entry.kind === 'company');
    expect(matched?.action).toBe('skip');
    expect(matched?.reason).toContain('ArmorX.ai');
    expect(matched?.reason).toContain('Kapalya, Inc. dba ArmorX.ai');
  });

  it('still creates a genuinely new company', () => {
    commit(fileNamed('ArmorX.ai'));
    commit(fileNamed('Bowtie Security'));
    expect(db.listCompanies()).toHaveLength(2);
  });
});

describe('research prompt: what the app hands you to run elsewhere', () => {
  const prompt = companyResearchPrompt('AutoBridge Systems', 'https://autobridge.example');

  it('names the company and the schema the answer must use', () => {
    expect(prompt).toContain('AutoBridge Systems');
    expect(prompt).toContain('https://autobridge.example');
    expect(prompt).toContain(IMPORT_SCHEMA_ID);
    expect(prompt).toContain(`schema version ${IMPORT_SCHEMA_VERSION}`);
  });

  it('asks only for company profile fields, never for board positions or pay', () => {
    expect(prompt).toContain('business_summary');
    expect(prompt).toContain('sector');
    expect(prompt).toContain('Return no `positions` array.');
    expect(prompt).toContain('Do not write anything about my own board seat, compensation');
  });

  it('forbids guessing and requires a source for every claim', () => {
    expect(prompt.toLowerCase()).toContain('do not guess');
    expect(prompt).toContain('sources');
    expect(prompt).toContain('confidence');
  });

  it('omits the website line when none is on file', () => {
    expect(companyResearchPrompt('AutoBridge Systems')).not.toContain('Known website');
  });
});
