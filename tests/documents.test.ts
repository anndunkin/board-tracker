import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { companyInput, documentInput, nonCashInput, positionInput, testDatabase } from './helpers';
import type { BoardTrackerDatabase } from '../src/main/database';
let db: BoardTrackerDatabase; let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = testDatabase())); afterEach(() => cleanup());
const context = (name = 'Example Corp') => { const company = db.createCompany(companyInput(name)); const position = db.createPosition(positionInput(company.id)); const stock = db.listInstrumentTypes().find((item) => item.name === 'Stock')!; const compensation = db.createCompensation(nonCashInput(position.id, stock.id)); return { company, position, compensation }; };

describe('documents: CRUD and linked-file workflow', () => {
  it('creates, updates, lists, and deletes a linked document with its joined position and compensation context', () => {
    const { company, position, compensation } = context(); const created = db.createDocument(documentInput(company.id, { position_id: position.id, compensation_id: compensation.id, document_type: 'grant_agreement' }));
    expect(db.getCompany(company.id)?.documents).toEqual([expect.objectContaining({ id: created.id, file_name: 'agreement.pdf', position_type: 'governing_board', compensation_type: 'non_cash', instrument_type_name: 'Stock' })]);
    const updated = db.updateDocument(created.id, documentInput(company.id, { position_id: position.id, document_type: 'offer_letter', file_path: 'C:\\Board Documents\\offer.pdf', file_name: 'Offer letter.pdf', description: 'Updated link' }));
    expect(updated).toMatchObject({ document_type: 'offer_letter', file_name: 'Offer letter.pdf', description: 'Updated link', compensation_id: null });
    db.deleteDocument(created.id); expect(db.getCompany(company.id)?.documents).toEqual([]);
  });
  it('creates a missing placeholder and updates that same record to attach a file and flip it to linked', () => {
    const { company, position } = context(); const missing = db.createDocument(documentInput(company.id, { position_id: position.id, document_type: 'confirmation_of_shares', file_path: null, file_name: null, description: 'Awaiting confirmation', status: 'missing' }));
    expect(missing).toMatchObject({ status: 'missing', file_path: null, file_name: null });
    const linked = db.updateDocument(missing.id, documentInput(company.id, { position_id: position.id, document_type: 'confirmation_of_shares', file_path: 'C:\\Board Documents\\share-confirmation.pdf', file_name: 'share-confirmation.pdf', description: 'Received', status: 'linked' }));
    expect(linked).toMatchObject({ id: missing.id, status: 'linked', file_path: 'C:\\Board Documents\\share-confirmation.pdf', file_name: 'share-confirmation.pdf' });
  });
  it('sets position and compensation links to null when their records are deleted, while retaining the document', () => {
    const { company, position, compensation } = context(); const document = db.createDocument(documentInput(company.id, { position_id: position.id, compensation_id: compensation.id }));
    db.deleteCompensation(compensation.id); expect(db.getCompany(company.id)?.documents[0]).toMatchObject({ id: document.id, position_id: position.id, compensation_id: null });
    db.deletePosition(position.id); expect(db.getCompany(company.id)?.documents[0]).toMatchObject({ id: document.id, position_id: null, compensation_id: null });
  });
  it('cascades documents when their company is deleted', () => {
    const { company } = context(); db.createDocument(documentInput(company.id)); db.deleteCompany(company.id); expect(db.db.prepare('SELECT COUNT(*) FROM documents').pluck().get()).toBe(0);
  });
  it('lists missing documents on the dashboard sorted by company name', () => {
    const zeta = context('Zeta Holdings').company; const alpha = context('Alpha Ventures').company;
    db.createDocument(documentInput(zeta.id, { document_type: 'nda', file_path: null, file_name: null, status: 'missing' })); db.createDocument(documentInput(alpha.id, { document_type: 'offer_letter', file_path: null, file_name: null, status: 'missing' }));
    expect(db.dashboard().missing_documents.map((item) => item.company_name)).toEqual(['Alpha Ventures', 'Zeta Holdings']);
  });
});

describe('documents: safe persistence and boundaries', () => {
  it('parameterizes file paths, descriptions, and document types containing SQL injection text', () => {
    const { company } = context(); const payload = "x'); DROP TABLE companies; --"; const document = db.createDocument(documentInput(company.id, { document_type: payload, file_path: `C:\\${payload}\\agreement.pdf`, file_name: 'agreement.pdf', description: payload }));
    expect(document).toMatchObject({ document_type: payload, description: payload }); expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").pluck().get()).toBe('companies');
  });
  it('keeps an XSS description as inert text for React to escape', () => {
    const { company } = context(); const payload = '<img src=x onerror=alert(1)>'; const document = db.createDocument(documentInput(company.id, { description: payload })); const html = renderToStaticMarkup(createElement('p', null, document.description));
    expect(document.description).toBe(payload); expect(html).not.toContain('<img '); expect(html).toContain('&lt;img');
  });
  it('accepts a Windows-length file path and rejects one beyond the supported validation limit', () => {
    const { company } = context(); const longPath = `C:\\${'x'.repeat(32764)}`; expect(db.createDocument(documentInput(company.id, { file_path: longPath, file_name: 'long.pdf' })).file_path).toBe(longPath);
    expect(() => db.createDocument(documentInput(company.id, { file_path: `${longPath}x`, file_name: 'too-long.pdf' }))).toThrow('File path');
  });
  it('rejects empty required fields, invalid statuses, invalid dates, and paths on missing placeholders', () => {
    const { company } = context(); expect(() => db.createDocument(documentInput(company.id, { document_type: '' }))).toThrow('Document type'); expect(() => db.createDocument(documentInput(company.id, { file_path: '', file_name: '' }))).toThrow('File path');
    expect(() => db.createDocument(documentInput(company.id, { status: 'requested' as never }))).toThrow('status'); expect(() => db.createDocument(documentInput(company.id, { document_date: '2026-02-30' }))).toThrow('Document date'); expect(() => db.createDocument(documentInput(company.id, { status: 'missing', file_path: 'C:\\still-here.pdf', file_name: 'still-here.pdf' }))).toThrow('File path');
  });
});
