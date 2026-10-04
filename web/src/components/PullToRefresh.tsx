import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

// How far to pull before letting go refreshes, in pixels.
const TRIGGER = 72;
const MAX_PULL = 110;

// Whether a touch that starts on this element could be scrolling something
// inside the page rather than pulling the page itself.
function insideScrolledArea(target: EventTarget | null) {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight &&
      node.scrollTop > 0
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

// Pull down from the top of any page on a touch screen to refresh it. The
// data on the page is fetched again; pages with nothing to fetch reload.
export function PullToRefresh() {
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const canStart = (event: TouchEvent) =>
      !busy.current &&
      event.touches.length === 1 &&
      window.scrollY <= 0 &&
      !document.documentElement.classList.contains("lock-scroll") &&
      document.body.style.overflow !== "hidden" &&
      !document.querySelector('[aria-modal="true"]') &&
      !insideScrolledArea(event.target);

    const onStart = (event: TouchEvent) => {
      startY.current = canStart(event) ? event.touches[0].clientY : null;
    };

    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const distance = event.touches[0].clientY - startY.current;
      if (distance <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Resist a little, the further it goes.
      const eased = Math.min(MAX_PULL, distance * 0.5);
      pullRef.current = eased;
      setPull(eased);
      setDragging(true);
      if (event.cancelable) event.preventDefault();
    };

    const onEnd = async () => {
      const reached = pullRef.current >= TRIGGER;
      startY.current = null;
      pullRef.current = 0;
      setDragging(false);
      if (!reached) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(TRIGGER * 0.75);
      const started = Date.now();
      if (
        queryClient.isFetching() === 0 &&
        !queryClient
          .getQueryCache()
          .getAll()
          .some((query) => query.getObserversCount() > 0)
      ) {
        window.location.reload();
        return;
      }
      await queryClient.invalidateQueries();
      // Keep the spinner up long enough to be seen.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 600 - (Date.now() - started))),
      );
      busy.current = false;
      setRefreshing(false);
      setPull(0);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [queryClient]);

  if (pull === 0 && !refreshing) return null;

  const progress = Math.min(1, pull / TRIGGER);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={refreshing ? "Refreshing" : "Pull to refresh"}
      className="pointer-events-none fixed left-1/2 top-0 z-[80]"
      style={{
        transform: `translate(-50%, ${pull - 44}px)`,
        transition: dragging ? "none" : "transform 200ms ease-out",
        opacity: Math.max(0.2, progress),
      }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-5 w-5 text-teal-600 dark:text-teal-400 ${refreshing ? "animate-spin" : ""}`}
          style={
            refreshing
              ? undefined
              : { transform: `rotate(${progress * 270}deg)` }
          }
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </svg>
      </span>
    </div>
  );
}
