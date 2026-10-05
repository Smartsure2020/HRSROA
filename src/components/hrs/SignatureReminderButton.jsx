import { useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { sendSignatureReminder } from "../../lib/roaSubmissionClient";
import {
  buildSignatureReminderFeedback,
  canOfferSignatureReminder,
  reminderCooldownSeconds,
  signatureReminderErrorMessage,
} from "../../lib/signatureReminder";

/**
 * "Send reminder" for an existing signature request. Renders nothing unless the submission is
 * still awaiting the client's signature. Never creates a new envelope.
 */
export default function SignatureReminderButton({
  submission,
  onSubmissionUpdate,
  recipientEmail = null,
  variant = "dark",
  className = "",
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!canOfferSignatureReminder(submission)) return null;

  const cooldown = reminderCooldownSeconds(submission.lastReminderAt);
  const palette = variant === "dark"
    ? "bg-white/10 text-white border-white/30 hover:bg-white/20 hover:border-white/60"
    : "bg-card text-hrs-blue border-hrs-orange hover:bg-hrs-orange/10";

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendSignatureReminder(submission.submissionId);
      if (result.submission && onSubmissionUpdate) onSubmissionUpdate(result.submission);
      toast(buildSignatureReminderFeedback(recipientEmail));
    } catch (err) {
      setError(signatureReminderErrorMessage(err?.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || cooldown > 0}
        title={cooldown > 0 ? "A reminder was sent recently" : "Re-send the signing email on the existing request"}
        className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-[0.8rem] border transition-all disabled:opacity-60 disabled:cursor-not-allowed ${palette}`}
      >
        <BellRing className="w-4 h-4" />
        {busy ? "Sending reminder..." : "Send reminder"}
      </button>
      {cooldown > 0 && !busy && (
        <p className={`text-[0.72rem] mt-1 ${variant === "dark" ? "text-white/60" : "text-hrs-muted"}`}>
          Reminder sent {new Date(submission.lastReminderAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}. You can send another in a few minutes.
        </p>
      )}
      {error && <p className={`text-[0.75rem] mt-1 ${variant === "dark" ? "text-red-300" : "text-red-600"}`}>{error}</p>}
    </div>
  );
}
