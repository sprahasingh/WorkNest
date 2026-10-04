import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { sendFeedback } from "@/api/feedback";
import { feedbackEnabledQuery } from "./queries";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputStyles } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { parseApiError } from "@/lib/apiError";
import { shrinkImageToDataUrl } from "@/lib/shrinkImage";
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
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Started when the app loads (see FeedbackProvider), so by the time the form
  // opens this is already known and the form doesn't change shape under you.
  const enabled = useQuery(feedbackEnabledQuery);

  const pickPicture = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image.");
      return;
    }
    try {
      setScreenshot(await shrinkImageToDataUrl(file));
      setError(null);
    } catch {
      setError("That picture couldn't be read. Try a PNG or JPG.");
    }
  };

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
        screenshot: sender ? (screenshot ?? undefined) : undefined,
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
      ) : enabled.isPending ? (
        <div
          className="space-y-3"
          role="status"
          aria-label="Loading the feedback form"
        >
          <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      ) : fallback ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            We&apos;d love to hear what you think. Send your feedback by email
            to:
          </p>
          <p className="break-all rounded-lg bg-slate-50 px-3 py-2.5 text-center text-sm font-medium text-slate-800 select-all dark:bg-slate-800 dark:text-slate-100">
            {FEEDBACK_EMAIL}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <a
              href={feedbackMailto(from, sender)}
              className="inline-flex flex-1 items-center justify-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 sm:flex-none"
            >
              Open my email app
            </a>
            <Button
              variant="secondary"
              onClick={copyAddress}
              className="flex-1 sm:flex-none"
            >
              Copy address
            </Button>
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
          {sender && (
            <div>
              {screenshot ? (
                <div className="flex items-center gap-3">
                  <img
                    src={screenshot}
                    alt="Screenshot you are sending"
                    className="h-16 w-16 rounded-lg border border-slate-200 object-cover dark:border-slate-600"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setScreenshot(null)}
                  >
                    Remove picture
                  </Button>
                </div>
              ) : (
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  Attach a screenshot (optional)
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      void pickPicture(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          )}
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
