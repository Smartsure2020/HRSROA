import { describe, expect, it } from 'vitest';
import { crmEvidenceLabel, isCrmSyncFinal } from '../src/pages/RoaRegister.jsx';

describe('register CRM evidence presentation', () => {
  const documenso = {
    signingProvider: 'documenso',
    crmSyncStatus: 'linked',
    crmSignedRoaDocumentId: 'd1',
    crmCertificateDocumentId: 'd2',
  };

  it('offers a CRM retry/backfill for Documenso rows linked without an audit log', () => {
    expect(isCrmSyncFinal(documenso)).toBe(false);
    expect(crmEvidenceLabel(documenso)).toBe('Partly filed (Signed ROA, certificate)');
    const full = { ...documenso, crmAuditLogDocumentId: 'd3' };
    expect(isCrmSyncFinal(full)).toBe(true);
    expect(crmEvidenceLabel(full)).toBe('Signed ROA + certificate + audit log filed');
  });

  it('keeps the two-document presentation for DocuSign', () => {
    const docusign = { ...documenso, signingProvider: 'docusign' };
    expect(isCrmSyncFinal(docusign)).toBe(true);
    expect(crmEvidenceLabel(docusign)).toBe('Signed ROA + certificate filed');
    expect(crmEvidenceLabel({})).toBe('Not filed');
  });
});
