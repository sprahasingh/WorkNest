// A small drawing of the real app (sidebar, dashboard cards, trend chart) with
// a message and a meeting floating over it. It's built from the same colours
// and labels as the product, so it matches what people see after signing up.
const NAV = [
  { label: "Dashboard", active: true },
  { label: "Projects" },
  { label: "Messages", badge: "2" },
  { label: "Meetings", badge: "2" },
  { label: "Members" },
];

const STATS = [
  { label: "Open tasks", value: "16", note: "6 in progress" },
  { label: "Completed", value: "5", note: "+5 vs previous" },
  { label: "Created", value: "11", note: "+6 vs previous" },
  { label: "Overdue", value: "1", note: "Needs attention", warn: true },
];

export function HeroPreview() {
  return (
    <div
      role="img"
      aria-label="A preview of the WorkNest dashboard, with a chat message and a meeting reminder"
      className="relative w-full max-w-xl pb-20 sm:pb-[4.5rem]"
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-100">
            <span className="flex h-4 w-4 items-center justify-center rounded bg-teal-600 text-[8px] text-white">
              W
            </span>
            WorkNest
          </span>
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-red-300" />
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
          </span>
        </div>

        <div className="flex">
          <div className="hidden w-32 shrink-0 border-r border-slate-200 p-2 sm:block dark:border-slate-700">
            <div className="mb-2 flex items-center gap-1.5 rounded-md px-1.5 py-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded bg-slate-200 text-[8px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                S
              </span>
              <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                Sunshine
              </span>
            </div>
            {NAV.map((item) => (
              <div
                key={item.label}
                className={`mb-0.5 flex items-center justify-between rounded-md px-2 py-1.5 text-[10px] font-medium ${
                  item.active
                    ? "bg-teal-600 text-white"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {item.label}
                {item.badge && (
                  <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-teal-600 px-1 text-[8px] font-bold text-white">
                    {item.badge}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="min-w-0 flex-1 bg-slate-100 p-3 dark:bg-slate-950">
            <p className="text-xs font-bold text-slate-900 dark:text-slate-50">
              Dashboard
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  <p className="text-[9px] text-slate-500 dark:text-slate-400">
                    {stat.label}
                  </p>
                  <p className="text-base font-bold leading-tight text-slate-900 dark:text-slate-50">
                    {stat.value}
                  </p>
                  <p
                    className={`text-[8px] ${
                      stat.warn
                        ? "text-orange-600 dark:text-orange-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {stat.note}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[10px] font-semibold text-slate-800 dark:text-slate-100">
                Open work
                <span className="ml-1.5 rounded-full bg-teal-50 px-1.5 py-px text-[8px] font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                  Last 14 days
                </span>
              </p>
              <svg
                viewBox="0 0 240 70"
                className="mt-1 h-16 w-full"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {[10, 30, 50].map((y) => (
                  <line
                    key={y}
                    x1="0"
                    x2="240"
                    y1={y}
                    y2={y}
                    className="stroke-slate-200 dark:stroke-slate-700"
                    strokeWidth="1"
                  />
                ))}
                <polyline
                  points="0,40 18,36 37,32 55,36 74,29 92,26 111,26 129,18 148,15 166,15 185,15 203,26 222,29 240,29"
                  fill="none"
                  stroke="#2f76d6"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <polyline
                  points="0,54 18,54 37,54 55,54 74,54 92,54 111,50 129,50 148,50 166,46 185,46 203,43 222,43 240,43"
                  fill="none"
                  stroke="#e5a00d"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-3 w-[calc(100%-1.5rem)] max-w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800 sm:left-6 sm:w-64">
        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          Website Relaunch
        </p>
        <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-200">
          <span className="font-semibold">Govind:</span> Draft agenda for
          Thursday is in the meeting invite.
        </p>
        <div className="mt-1.5 flex gap-1">
          <span className="rounded-full border border-teal-500 bg-teal-50 px-1.5 py-px text-[9px] font-semibold text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
            👍 2
          </span>
          <span className="rounded-full border border-slate-200 px-1.5 py-px text-[9px] font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300">
            🎉 1
          </span>
        </div>
      </div>

      <div className="absolute bottom-0 right-0 hidden w-52 rounded-xl border border-emerald-200 bg-white p-3 shadow-lg dark:border-emerald-800 dark:bg-slate-800 sm:block">
        <p className="text-[9px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">
          Next up
        </p>
        <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-50">
          Daily standup
        </p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            Starts in 12 min
          </span>
          <span className="rounded-md bg-teal-600 px-2 py-0.5 text-[9px] font-semibold text-white">
            Join
          </span>
        </div>
      </div>
    </div>
  );
}
