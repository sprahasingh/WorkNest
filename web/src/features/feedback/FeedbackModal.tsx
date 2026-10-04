import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { getFeedbackEnabled, sendFeedback } from "@/api/feedback";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { parseApiError } from "@/lib/apiError";
import { FEEDBACK_EMAIL, feedbackMailto } from "@/lib/feedback";

// Feedback is typed here and sent by the server, so it works on every device.
// Opening an email app from a link is unreliable on computers: some browsers
// have no mail handler set up and land on a search page instead.
export function FeedbackModal({
  open,
  from,
  onClose,
}: {
  open: boolean;
  from?: string;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Send feedback">
      {/* Mounted only while open, so every visit starts with a fresh form. */}
      <FeedbackBody from={from} onClose={onClose} />
    </Modal>
  );
}

function FeedbackBody({
  from,
  onClose,
}: {
  from?: string;
  onClose: () => void;
}) {
  const auth = useAuth();
  const sender = auth.status === "authenticated" ? auth.user : null;
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = useQuery({
    queryKey: ["feedback", "enabled"],
    queryFn: getFeedbackEnabled,
    staleTime: 5 * 60 * 1000,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim().length < 5) {
      setError("Please write a little more.");
      return;
    }
    setError(null);
    setIsSending(true);
    try {
      await sendFeedback({
        message: message.trim(),
        email: sender ? undefined : email.trim() || undefined,
        page: from && from !== "/" ? from : undefined,
        website,
      });
      setSent(true);
    } catch (failure) {
      setError(parseApiError(failure).message);
    } finally {
      setIsSending(false);
    }
  };

  const copyAddress = () => {
    void navigator.clipboard
      ?.writeText(FEEDBACK_EMAIL)
      .then(() => toast.success("Email address copied"))
      .catch(() => toast.error("Couldn't copy"));
  };

  // Not set up on the server: offer the plain email route instead.
  const fallback = enabled.isSuccess && !enabled.data;

  return (
    <>
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Thank you. Your feedback was sent
            {sender || email ? ", and a reply will go to your email" : ""}.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : fallback ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Sending from here isn&apos;t switched on, so please email us at{" "}
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {FEEDBACK_EMAIL}
            </span>
            .
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={copyAddress}>
              Copy address
            </Button>
            <a
              href={feedbackMailto(from, sender)}
              className="inline-flex items-center justify-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Open my email app
            </a>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="space-y-4"
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Tell us what works, what doesn&apos;t, or what you&apos;d like to
            see. It goes straight to the person who built WorkNest.
          </p>
          <ErrorBanner message={error} />
          <Field label="Your feedback" htmlFor="feedback-message">
            <textarea
              id="feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={2000}
              autoFocus
              className={inputStyles}
            />
          </Field>
          {!sender && (
            <Field
              label="Your email (optional)"
              htmlFor="feedback-email"
              hint="Only if you'd like a reply."
            >
              <input
                id="feedback-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputStyles}
              />
            </Field>
          )}
          {/* Real people never see this field. Bots fill it in. */}
          <div aria-hidden="true" className="absolute -left-[9999px]">
            <label>
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSending || message.trim().length < 5}
              loading={isSending}
            >
              {isSending ? "Sending…" : "Send feedback"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
