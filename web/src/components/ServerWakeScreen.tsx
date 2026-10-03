import { useEffect, useState } from "react";
import {
  getServerWakeStartedAt,
  isServerReady,
  subscribeServerWakeChange,
} from "@/api/client";

// The free server sleeps when nobody's using it and takes about 50 seconds
// to start again. This screen covers that wait so it doesn't feel broken.
const EXPECTED_WAKE_MS = 50_000;
const FACT_INTERVAL_MS = 7_000;

const STAGES: { from: number; text: string }[] = [
  { from: 0, text: "Waking up the server…" },
  { from: 10_000, text: "Starting WorkNest…" },
  { from: 25_000, text: "Connecting to your data…" },
  { from: 40_000, text: "Almost there…" },
  {
    from: EXPECTED_WAKE_MS,
    text: "Taking a little longer than usual. Hang on…",
  },
];

const FACTS = [
  "Why the wait? WorkNest runs on a free server that naps when nobody's around. You're waking it up for everyone.",
  "Tip: double-tap a dashboard chart to see the exact numbers.",
  'Fun fact: the first computer "bug" was a real moth, found stuck in a Harvard computer in 1947.',
  "Tip: type @ in a task's updates to bring someone into the conversation.",
  "Fun fact: a day on Venus is longer than its whole year.",
  "Tip: deleted projects wait in the Bin for 30 days, so nothing is lost by accident.",
  "Fun fact: octopuses have three hearts.",
  "Tip: set your organization's time zone in Settings so due dates match your day.",
  "Fun fact: bananas count as berries, but strawberries don't.",
  "Tip: use Custom range on the dashboard to look at any dates you like.",
];

export function ServerWakeScreen() {
  const [isWaking, setIsWaking] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(
    () =>
      subscribeServerWakeChange((waking) => {
        if (waking) {
          setIsFinishing(false);
          setIsWaking(true);
          return;
        }
        // A wait that timed out or was cancelled just closes; a real wake-up
        // fills the bar first so it ends on "Ready!" rather than vanishing.
        if (!isServerReady()) {
          setIsWaking(false);
          return;
        }
        setIsFinishing(true);
        window.setTimeout(() => {
          setIsWaking(false);
          setIsFinishing(false);
        }, 600);
      }),
    [],
  );

  if (!isWaking) return null;
  return <WakeCard finishing={isFinishing} />;
}

function WakeCard({ finishing }: { finishing: boolean }) {
  const [startedAt] = useState(getServerWakeStartedAt);
  const [now, setNow] = useState(() => Date.now());
  // Opens on why there's a wait, then moves through the rest.
  const [factIndex, setFactIndex] = useState(0);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    const facts = window.setInterval(
      () => setFactIndex((index) => (index + 1) % FACTS.length),
      FACT_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(tick);
      window.clearInterval(facts);
    };
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  // Fills over the expected 50 seconds, then creeps on slowly so it never
  // looks stuck or claims to be done before it is.
  const percent = finishing
    ? 100
    : elapsed <= EXPECTED_WAKE_MS
      ? (elapsed / EXPECTED_WAKE_MS) * 92
      : Math.min(98, 92 + (elapsed - EXPECTED_WAKE_MS) / 5_000);
  const stage = finishing
    ? "Ready!"
    : [...STAGES].reverse().find((item) => elapsed >= item.from)!.text;
  const secondsLeft = Math.max(
    0,
    Math.ceil((EXPECTED_WAKE_MS - elapsed) / 1000),
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wake-title"
      aria-describedby="wake-stage"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 dark:ring-1 dark:ring-slate-700">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-lg font-bold text-white">
            W
          </span>
          <div>
            <h2
              id="wake-title"
              className="font-semibold text-slate-900 dark:text-slate-50"
            >
              Getting WorkNest ready
            </h2>
            <p
              id="wake-stage"
              role="status"
              aria-live="polite"
              className="text-sm text-slate-600 dark:text-slate-300"
            >
              {stage}
            </p>
          </div>
        </div>

        <div
          className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="progressbar"
          aria-label="Server start-up progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <div
            className="h-full rounded-full bg-teal-500 transition-[width] duration-300 ease-linear motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1.5 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {finishing
            ? "Done"
            : secondsLeft > 0
              ? `About ${secondsLeft}s left`
              : "Nearly done"}
        </p>

        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          Please keep this page open and don&apos;t refresh. We&apos;ll carry on
          by ourselves as soon as it&apos;s ready.
        </p>

        <p
          key={factIndex}
          className="mt-4 min-h-[3rem] text-sm text-slate-600 animate-[fade-in_400ms_ease-out] motion-reduce:animate-none dark:text-slate-300"
        >
          {FACTS[factIndex]}
        </p>
      </div>
    </div>
  );
}
