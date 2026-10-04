import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { TEST_CARD, copyText } from "./testDetails";

// Test mode only. Razorpay's window can't be filled in by this page and covers
// the screen once it is open, so the one value worth copying is the card
// number, and it is also copied when Upgrade is pressed. The rest can be
// anything, which the box says in plain words.
export function TestPaymentBox() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyText(TEST_CARD)) {
      setCopied(true);
      toast.success("Card number copied");
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error("Couldn't copy. Select the number and copy it instead.");
    }
  };

  return (
    <section
      aria-label="Test payment details"
      className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/50"
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Test mode
        </span>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No real money moves.
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Test card number
          </p>
          <p className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-50">
            {TEST_CARD}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy test card number"
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
            copied
              ? "bg-teal-600 text-white dark:bg-teal-500"
              : "bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-300 dark:hover:bg-teal-900/50",
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        For the expiry, use any future date. For the CVV, any 3 digits. The name
        can be anything. The card is also copied when you press Upgrade.
      </p>
    </section>
  );
}
