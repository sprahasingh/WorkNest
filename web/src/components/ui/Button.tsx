import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabledReason?: string;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-teal-600 text-white hover:bg-teal-700 focus-visible:outline-teal-600 dark:bg-teal-500 dark:hover:bg-teal-400",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-teal-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600 dark:bg-red-500 dark:hover:bg-red-400",
  ghost:
    "text-slate-600 hover:bg-slate-100 focus-visible:outline-teal-600 dark:text-slate-300 dark:hover:bg-slate-800",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "min-h-11 min-w-11 px-3 py-2 text-sm",
  md: "min-h-11 min-w-11 px-4 py-2 text-sm",
};

let activeDisabledMessageId: string | null = null;
const disabledMessageListeners = new Set<(activeId: string | null) => void>();

function setActiveDisabledMessage(id: string | null) {
  activeDisabledMessageId = id;
  disabledMessageListeners.forEach((listener) => listener(id));
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  disabledReason,
  title,
  onClick,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const tooltipId = useId();
  const [showDisabledMessage, setShowDisabledMessage] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const hideMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionId = useRef(0);
  const pointerDownInteraction = useRef<number | null>(null);
  const suppressHoverUntilLeave = useRef(false);
  const { ["aria-describedby"]: describedBy, ...buttonProps } = props;
  const disabledMessage =
    disabledReason ?? title ?? "This action is unavailable right now.";
  const hideDisabledMessage = useCallback(() => {
    if (hideMessageTimer.current) clearTimeout(hideMessageTimer.current);
    setShowDisabledMessage(false);
    if (activeDisabledMessageId === tooltipId) {
      setActiveDisabledMessage(null);
    }
  }, [tooltipId]);

  useEffect(() => {
    const listener = (activeId: string | null) => {
      if (activeId === tooltipId) return;
      if (hideMessageTimer.current) clearTimeout(hideMessageTimer.current);
      setShowDisabledMessage(false);
    };
    disabledMessageListeners.add(listener);
    return () => {
      disabledMessageListeners.delete(listener);
      if (hideMessageTimer.current) clearTimeout(hideMessageTimer.current);
      if (activeDisabledMessageId === tooltipId) {
        setActiveDisabledMessage(null);
      }
    };
  }, [tooltipId]);

  useEffect(
    () => () => {
      if (hideMessageTimer.current) clearTimeout(hideMessageTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!isDisabled || !showDisabledMessage) return;
    const openingId = interactionId.current;
    const placeTooltip = () => {
      if (openingId !== interactionId.current) return;
      const anchor = wrapperRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!anchor || !tooltip) return;
      const margin = 8;
      const left = Math.min(
        Math.max(margin, anchor.left + anchor.width / 2 - tooltip.width / 2),
        window.innerWidth - tooltip.width - margin,
      );
      const below = anchor.bottom + margin;
      const top =
        below + tooltip.height <= window.innerHeight - margin
          ? below
          : Math.max(margin, anchor.top - tooltip.height - margin);
      setTooltipPosition({ left, top });
    };
    const showTooltip = () => {
      if (openingId !== interactionId.current) return;
      placeTooltip();
      if (tooltipRef.current) tooltipRef.current.style.visibility = "visible";
    };
    const onScroll = () => {
      // Scrolling cancels this opening. Invalidate its animation-frame and any
      // delayed work before hiding, so an old callback cannot reopen it.
      interactionId.current += 1;
      suppressHoverUntilLeave.current = true;
      hideDisabledMessage();
    };
    const frame = requestAnimationFrame(showTooltip);
    window.addEventListener("resize", showTooltip);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", showTooltip);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isDisabled, showDisabledMessage, disabledMessage, hideDisabledMessage]);

  const showMessageAfterTap = () => {
    interactionId.current += 1;
    pointerDownInteraction.current = null;
    setActiveDisabledMessage(tooltipId);
    setShowDisabledMessage(true);
    if (hideMessageTimer.current) clearTimeout(hideMessageTimer.current);
    hideMessageTimer.current = setTimeout(hideDisabledMessage, 2500);
  };

  if (isDisabled) {
    return (
      <span
        ref={wrapperRef}
        className={cn(
          "relative inline-flex max-w-full cursor-not-allowed",
          className,
        )}
        onPointerDown={() => {
          pointerDownInteraction.current = interactionId.current;
        }}
        onPointerEnter={(event) => {
          if (
            event.pointerType === "mouse" &&
            !suppressHoverUntilLeave.current
          ) {
            interactionId.current += 1;
            setActiveDisabledMessage(tooltipId);
            setShowDisabledMessage(true);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") {
            suppressHoverUntilLeave.current = false;
            hideDisabledMessage();
          }
        }}
        onClick={() => {
          // Browsers can dispatch a click after a touch gesture that actually
          // scrolled. Ignore that synthetic click if scrolling invalidated the
          // pointer interaction that began it.
          if (
            pointerDownInteraction.current !== null &&
            pointerDownInteraction.current !== interactionId.current
          ) {
            pointerDownInteraction.current = null;
            return;
          }
          showMessageAfterTap();
        }}
      >
        <button
          disabled
          aria-busy={loading || undefined}
          aria-describedby={
            [describedBy, showDisabledMessage ? tooltipId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            VARIANT_STYLES[variant],
            SIZE_STYLES[size],
            "pointer-events-none",
            className,
          )}
          {...buttonProps}
        >
          {loading && <Spinner className="h-4 w-4" />}
          {children}
        </button>
        {showDisabledMessage &&
          createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none fixed z-[1000] w-max max-w-[min(18rem,calc(100vw-1rem))] overflow-y-auto whitespace-normal break-words rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
              style={{
                top: tooltipPosition.top,
                left: tooltipPosition.left,
                maxHeight: "calc(100dvh - 1rem)",
                visibility: tooltipPosition.top === 0 ? "hidden" : "visible",
              }}
            >
              {disabledMessage}
            </span>,
            document.body,
          )}
      </span>
    );
  }

  return (
    <button
      disabled={false}
      aria-busy={loading || undefined}
      title={title}
      onClick={(event) => {
        setActiveDisabledMessage(null);
        onClick?.(event);
      }}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
      {...buttonProps}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
