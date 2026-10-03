import type { MouseEvent } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "@/lib/cn";

interface BrandLinkProps {
  // "app" is the compact version in the app header.
  size?: "app" | "page";
  // "onBrand" is for the teal panel beside the sign-in forms.
  tone?: "default" | "onBrand";
  className?: string;
  // Called when the click stays on the home page, so a menu can close.
  onSameDestination?: () => void;
}

// The WorkNest mark and name. It always goes to the home page, and on the home
// page it scrolls back to the top, so it behaves the same wherever it appears.
export function BrandLink({
  size = "page",
  tone = "default",
  className,
  onSameDestination,
}: BrandLinkProps) {
  const { pathname } = useLocation();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== "/") return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    onSameDestination?.();
  };

  return (
    <Link
      to="/"
      onClick={handleClick}
      aria-label="WorkNest home"
      className={cn(
        "flex items-center gap-2 rounded-md font-bold outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600",
        size === "app" ? "text-base" : "text-lg",
        tone === "onBrand"
          ? "text-white focus-visible:outline-white"
          : "text-slate-900 dark:text-slate-100",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center font-bold",
          size === "app" ? "h-7 w-7 rounded-md text-xs" : "h-8 w-8 rounded-lg",
          tone === "onBrand"
            ? "bg-white/15 text-white"
            : "bg-teal-600 text-white",
        )}
      >
        W
      </span>
      <span aria-hidden="true">WorkNest</span>
    </Link>
  );
}
