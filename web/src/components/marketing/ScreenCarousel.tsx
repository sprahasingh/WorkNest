import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { Screen } from "@/assets/screens";
import { BrowserFrame, Screenshot } from "./Screenshot";

interface ScreenCarouselProps {
  screens: Screen[];
  label: string;
  className?: string;
}

const ARROW =
  "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:pointer-events-none disabled:opacity-0 dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-200 dark:hover:bg-slate-800";

// Several screenshots of one feature in a row you can swipe or step through.
// With a single slide it renders just the picture, so callers don't need to
// special-case it.
export function ScreenCarousel({
  screens,
  label,
  className,
}: ScreenCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const captionId = useId();

  // The track's scroll position is the source of truth, so swiping, the
  // arrows and the dots can never disagree with each other.
  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }, []);

  const goTo = useCallback((next: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
  }, []);

  // Keep the current slide in view if the window is resized.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => {
      track.scrollTo({ left: index * track.clientWidth });
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [index]);

  if (screens.length === 1) {
    const only = screens[0];
    return (
      <figure className={className}>
        <BrowserFrame>
          <Screenshot screen={only} />
        </BrowserFrame>
        <figcaption className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          {only.caption}
        </figcaption>
      </figure>
    );
  }

  const current = screens[Math.min(index, screens.length - 1)];

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      className={className}
    >
      <div className="relative">
        <BrowserFrame>
          <div
            ref={trackRef}
            onScroll={handleScroll}
            tabIndex={0}
            aria-describedby={captionId}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" && index < screens.length - 1) {
                event.preventDefault();
                goTo(index + 1);
              } else if (event.key === "ArrowLeft" && index > 0) {
                event.preventDefault();
                goTo(index - 1);
              }
            }}
            className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600 motion-reduce:scroll-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {screens.map((screen, position) => (
              <div
                key={screen.key}
                role="group"
                aria-roledescription="slide"
                aria-label={`${position + 1} of ${screens.length}`}
                className="w-full shrink-0 snap-center"
              >
                <Screenshot screen={screen} />
              </div>
            ))}
          </div>
        </BrowserFrame>

        <button
          type="button"
          aria-label="Previous screen"
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
          className={cn(ARROW, "left-2 sm:left-3")}
        >
          <Chevron direction="left" />
        </button>
        <button
          type="button"
          aria-label="Next screen"
          disabled={index >= screens.length - 1}
          onClick={() => goTo(index + 1)}
          className={cn(ARROW, "right-2 sm:right-3")}
        >
          <Chevron direction="right" />
        </button>
      </div>

      <div className="mt-4 flex items-start justify-between gap-4">
        <p
          id={captionId}
          aria-live="polite"
          className="min-w-0 text-sm text-slate-600 dark:text-slate-300"
        >
          <span className="font-medium text-slate-900 dark:text-slate-50">
            {index + 1} of {screens.length}
          </span>
          <span className="mx-2 text-slate-300 dark:text-slate-600">|</span>
          {current.caption}
        </p>
        <div className="flex shrink-0 items-center">
          {screens.map((screen, position) => (
            <button
              key={screen.key}
              type="button"
              aria-label={`Show screen ${position + 1}`}
              aria-current={position === index}
              onClick={() => goTo(position)}
              className="group flex h-6 w-5 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <span
                className={cn(
                  "h-2 rounded-full transition-all",
                  position === index
                    ? "w-5 bg-teal-600 dark:bg-teal-400"
                    : "w-2 bg-slate-300 group-hover:bg-slate-400 dark:bg-slate-600 dark:group-hover:bg-slate-500",
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}
