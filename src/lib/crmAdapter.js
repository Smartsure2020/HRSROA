// HRSROA CRM integration seam.
//
// Browser-safe seam: only an HRSROA submission id crosses the browser boundary.
// Frozen data and evidence are loaded and sent by the HRSROA server.
import { syncCrmSubmission } from './roaSubmissionClient';

export async function syncRoaSubmissionToCRM(submissionId) {
  return syncCrmSubmission(submissionId);
}

export const CRM_ADAPTER_MODE = 'server_submission';

// Amended revisions (Issue #8) are filed in the CRM only once the CRM release that understands
// revision metadata is live and enabled. Until then the server defers them — nothing is
// mis-filed, nothing fails, and the evidence stays safely stored here.
export const CRM_REVISION_DEFERRED = 'crm_revision_sync_not_enabled';

export function isCrmSyncDeferred(message) {
  return message === CRM_REVISION_DEFERRED;
}

export function describeCrmSyncError(message) {
  if (isCrmSyncDeferred(message)) {
    return 'CRM filing for amended revisions is not switched on yet. This revision and its evidence are stored safely here and will be filed once it is enabled.';
  }
  return message;
}
