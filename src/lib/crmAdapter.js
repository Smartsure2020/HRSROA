// HRSROA CRM integration seam.
//
// Browser-safe seam: only an HRSROA submission id crosses the browser boundary.
// Frozen data and evidence are loaded and sent by the HRSROA server.
import { syncCrmSubmission } from './roaSubmissionClient';

export async function syncRoaSubmissionToCRM(submissionId) {
  return syncCrmSubmission(submissionId);
}

export const CRM_ADAPTER_MODE = 'server_submission';
