import { describeManualResolution } from '../../lib/signatureSendFeedback';

/**
 * Shown on a still-open signing request that the system could not cancel safely, so the
 * revision that replaces it has not been sent. A person has to take over; nothing here
 * lets the broker force it.
 */
export default function ManualResolutionNotice({ reason }) {
  if (!reason) return null;
  return (
    <p
      role="alert"
      className="basis-full rounded-md border border-hrs-orange bg-hrs-orange/10 px-3 py-2 text-[0.76rem] font-semibold text-hrs-blue"
    >
      Manual resolution required. {describeManualResolution(reason)}
    </p>
  );
}
