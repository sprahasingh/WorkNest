import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { ResponsiveContainer } from "recharts";
import { useTheme } from "@/theme/theme-context";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { useDismissOnScroll } from "@/hooks/useContextualOverlay";

// Two taps or clicks this close together (ms) count as a double tap.
const DOUBLE_TAP_MS = 350;

export interface ChartTheme {
  isDark: boolean;
  // The card's background, used for the thin gaps between touching marks.
  surfaceColor: string;
  gridColor: string;
  tickColor: string;
  // Spread onto <Tooltip>: its look, and whether it may show at all.
  tooltipProps: {
    active?: boolean;
    separator: string;
    // Values stay in text ink; the series color would be hard to read.
    itemStyle: { color: string };
    contentStyle: {
      background: string;
      border: string;
      borderRadius: number;
      color: string;
      fontSize: number;
    };
  };
}

// Exact numbers stay hidden until the chart is double-tapped (or
// double-clicked), so an ordinary tap or scroll doesn't pop them up.
function useDoubleTapDetails() {
  const [showDetails, setShowDetails] = useState(false);
  const lastTapRef = useRef(0);
  const pointerStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    pointerId: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useDismissOnScroll(showDetails, () => setShowDetails(false));

  // A tap anywhere else hides them again.
  useEffect(() => {
    if (!showDetails) return;
    const hideOnOutsideTap = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowDetails(false);
      }
    };
    document.addEventListener("pointerdown", hideOnOutsideTap);
    return () => document.removeEventListener("pointerdown", hideOnOutsideTap);
  }, [showDetails]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      pointerId: event.pointerId,
    };
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (
      !start ||
      start.pointerId !== event.pointerId ||
      event.timeStamp - start.time > 300 ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
    ) {
      return;
    }

    if (event.timeStamp - lastTapRef.current < DOUBLE_TAP_MS) {
      setShowDetails((shown) => !shown);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = event.timeStamp;
    }
  };

  // With a mouse, moving off the chart hides them too.
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") setShowDetails(false);
  };

  const onPointerCancel = () => {
    pointerStartRef.current = null;
  };

  return {
    showDetails,
    containerRef,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  };
}

// What time a number covers: right now, the period picked in the date
// range, or both. Shown on every dashboard card and tile so it's never a
// guess.
export interface Scope {
  now?: boolean;
  // e.g. "Last 14 days", "All time".
  period?: string;
}

export function ScopeTag({ scope }: { scope: Scope }) {
  const label =
    scope.now && scope.period
      ? `Now + ${scope.period}`
      : scope.now
        ? "Now"
        : (scope.period ?? "");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        scope.period
          ? "bg-teal-50 text-teal-800 ring-1 ring-teal-200 ring-inset dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-800"
          : "bg-slate-100 text-slate-600 ring-1 ring-slate-200 ring-inset dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600",
      )}
    >
      {label}
    </span>
  );
}

// A card's heading with its scope tag beside it.
export function CardTitle({ title, scope }: { title: string; scope?: Scope }) {
  return (
    <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-slate-800 dark:text-slate-100">
      {title}
      {scope && <ScopeTag scope={scope} />}
    </h2>
  );
}

export function ChartCard({
  title,
  scope,
  subtitle,
  summary,
  emptyMessage,
  description,
  chartClassName = "h-56",
  footer,
  children,
}: {
  title: string;
  scope?: Scope;
  subtitle?: string;
  // Headline numbers shown between the title and the chart.
  summary?: ReactNode;
  // Shown over the chart when there's no data to plot.
  emptyMessage?: string;
  // Text version of the chart for screen readers.
  description?: string;
  // Sets the chart's height; defaults to h-56.
  chartClassName?: string;
  // Shown under the chart, e.g. a legend with the exact numbers.
  footer?: ReactNode;
  children: (chartTheme: ChartTheme) => ReactElement;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const {
    showDetails,
    containerRef,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  } = useDoubleTapDetails();
  const chartTheme: ChartTheme = {
    isDark,
    surfaceColor: isDark ? "#1e293b" : "#ffffff",
    gridColor: isDark ? "#334155" : "#e2e8f0",
    tickColor: isDark ? "#94a3b8" : "#64748b",
    tooltipProps: {
      // false keeps it hidden; undefined lets it follow the pointer.
      active: showDetails ? undefined : false,
      separator: ": ",
      itemStyle: { color: isDark ? "#e2e8f0" : "#334155" },
      contentStyle: {
        background: isDark ? "#1e293b" : "#ffffff",
        border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
        borderRadius: 8,
        color: isDark ? "#f1f5f9" : "#0f172a",
        fontSize: 13,
      },
    },
  };

  return (
    <Card className="@container">
      {/* Title and hint share a line only when the card is wide enough for the
          longest hint, so the layout depends on the card's width rather than
          its words: cards side by side always match, and showing numbers
          never pushes the hint onto a new line. */}
      <div className="flex flex-col gap-1 @sm:flex-row @sm:items-baseline @sm:justify-between @sm:gap-3">
        <div className="min-w-0">
          <CardTitle title={title} scope={scope} />
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
        <p
          className="shrink-0 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400"
          aria-live="polite"
        >
          <span className="pointer-coarse:hidden">
            {showDetails
              ? "Double-click to hide numbers"
              : "Double-click for numbers"}
          </span>
          <span className="hidden pointer-coarse:inline">
            {showDetails
              ? "Double-tap to hide numbers"
              : "Double-tap for numbers"}
          </span>
        </p>
      </div>
      {summary && <div className="mt-3">{summary}</div>}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        data-details={showDetails ? "on" : "off"}
        // manipulation stops a double tap from zooming the page on phones;
        // no outline, so a tap doesn't leave a focus box around the chart.
        className={cn(
          "relative mt-4 touch-manipulation select-none [&_*]:outline-none",
          chartClassName,
        )}
        role="img"
        aria-label={description ? `${title}. ${description}` : title}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children(chartTheme)}
        </ResponsiveContainer>
        {emptyMessage && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            <span className="rounded-lg bg-white/90 px-3 py-1.5 shadow-sm dark:bg-slate-900/90">
              {emptyMessage}
            </span>
          </p>
        )}
      </div>
      {footer}
    </Card>
  );
}
