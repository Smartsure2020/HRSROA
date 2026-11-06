import { AlertTriangle, Pencil } from 'lucide-react';
import { amendReasonLabel } from '../../lib/roaAmendment';

/**
 * Persistent notice shown while a broker is editing an amendment (Issue #8). It states what
 * is being created, why, and — when the previous revision still has a live signing request —
 * that nothing is cancelled until the replacement is actually sent.
 */
export default function AmendmentBanner({ amendment, className = '' }) {
  if (!amendment) return null;
  const previous = Math.max((amendment.nextRevisionNo || 2) - 1, 1);
  return (
    <div className={`bg-amber-50 border-b border-amber-300 px-4 py-2.5 text-[0.8rem] text-amber-900 ${className}`}>
      <div className="max-w-[860px] mx-auto flex items-start gap-3">
        <Pencil className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">
            Amending ROA — this will create Revision {amendment.nextRevisionNo}
          </p>
          <p>
            Reason: {amendReasonLabel(amendment.reason) || '—'}
            {amendment.reasonDetail ? ` — ${amendment.reasonDetail}` : ''}. Revision {previous} and
            its signed documents are kept unchanged and stay downloadable.
          </p>
          {amendment.willCancelSigningRequest && (
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Revision {previous} is still awaiting signature. It stays valid while you edit and is
                cancelled only when you send Revision {amendment.nextRevisionNo} for signature.
              </span>
            </p>
          )}
          {amendment.warnings?.length > 0 && (
            <p>
              Some answers from the original could not be carried over automatically — please
              review every step before submitting.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
