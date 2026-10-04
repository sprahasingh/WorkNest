import { cn } from "@/lib/cn";
import type { Screen } from "@/assets/screens";
import { useImageViewer } from "@/components/imageViewerContext";

interface ScreenshotProps {
  screen: Screen;
  className?: string;
  // Load straight away for pictures that are on screen at the top of the page.
  eager?: boolean;
}

// One screenshot, in the light or dark version to match the theme. The one
// that isn't shown is display:none, so the browser never downloads it.
export function Screenshot({ screen, className, eager }: ScreenshotProps) {
  const { alt } = screen;
  const { openImage } = useImageViewer();
  const shared = {
    width: screen.width,
    height: screen.height,
    alt,
    loading: eager ? ("eager" as const) : ("lazy" as const),
    decoding: "async" as const,
  };
  // Opens whichever version is showing, so the large view matches the theme.
  const open = () => {
    const dark = document.documentElement.classList.contains("dark");
    openImage({ src: dark ? screen.dark : screen.light, alt });
  };
  return (
    <button
      type="button"
      onClick={open}
      aria-label={`View larger: ${alt}`}
      className="block w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600"
    >
      <img
        src={screen.light}
        {...shared}
        className={cn("block h-auto w-full dark:hidden", className)}
      />
      <img
        src={screen.dark}
        {...shared}
        className={cn("hidden h-auto w-full dark:block", className)}
      />
    </button>
  );
}

// A screenshot inside a plain browser window.
export function BrowserFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
      </div>
      {children}
    </div>
  );
}

// A screenshot inside a simple phone outline.
export function PhoneFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.75rem] border-[5px] border-slate-800 bg-white shadow-xl shadow-slate-300/60 dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/40",
        className,
      )}
    >
      {children}
    </div>
  );
}
