import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";

type Entry = {
  trigger: () => HTMLElement | null;
  overlay: () => HTMLElement | null;
  close: (reason: ContextualOverlayCloseReason) => void;
  dismissOnScroll: boolean;
  onScroll?: () => void;
};

export type ContextualOverlayCloseReason =
  "outside" | "scroll" | "escape" | "route" | "replaced";

let active: Entry | null = null;
let generation = 0;
let listening = false;
let scrollListening = false;
let clickListening = false;
let lastPointerDown: { target: EventTarget | null; generation: number } | null =
  null;
const scrollDismissals = new Set<() => void>();

function onPointerDown(event: PointerEvent) {
  const path = event.composedPath();
  lastPointerDown = { target: event.target, generation };
  const entry = active;
  if (!entry) return;
  if (
    !path.includes(entry.trigger() as EventTarget) &&
    !path.includes(entry.overlay() as EventTarget)
  )
    entry.close("outside");
}

function onScroll() {
  generation += 1;
  const entry = active;
  if (entry?.dismissOnScroll) entry.close("scroll");
  else entry?.onScroll?.();
  for (const dismiss of scrollDismissals) dismiss();
}

function startScrollListening() {
  if (scrollListening || typeof window === "undefined") return;
  scrollListening = true;
  window.addEventListener("scroll", onScroll, true);
}

function stopScrollListeningIfIdle() {
  if (!scrollListening || active || scrollDismissals.size > 0) return;
  scrollListening = false;
  window.removeEventListener("scroll", onScroll, true);
}

function onClick(event: MouseEvent) {
  const pointerDown = lastPointerDown;
  if (!pointerDown) return;
  lastPointerDown = null;
  if (pointerDown.generation === generation) return;

  const interactiveControl = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest(
          "button, a, input, select, textarea, [role='button'], [role='menuitem']",
        )
      : null;
  const pointerControl = interactiveControl(pointerDown.target);
  const clickControl = interactiveControl(event.target);
  if (pointerControl && pointerControl === clickControl) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !active) return;
  active.close("escape");
  event.preventDefault();
  event.stopPropagation();
}

function startListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  if (!clickListening) {
    clickListening = true;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
  }
  startScrollListening();
  document.addEventListener("keydown", onKeyDown, true);
}

function stopListening() {
  if (!listening || active) return;
  listening = false;
  stopScrollListeningIfIdle();
  document.removeEventListener("keydown", onKeyDown, true);
}

export function useContextualOverlay(
  open: boolean,
  triggerRef: { current: HTMLElement | null },
  overlayRef: { current: HTMLElement | null },
  onClose: (reason: ContextualOverlayCloseReason) => void,
  options: { dismissOnScroll?: boolean; onScroll?: () => void } = {},
) {
  const location = useLocation();
  const closeRef = useRef(onClose);
  const scrollRef = useRef(options.onScroll);
  const previousPath = useRef(location.pathname);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    scrollRef.current = options.onScroll;
  }, [options.onScroll]);

  useEffect(() => {
    if (!open) return;
    const entry: Entry = {
      trigger: () => triggerRef.current,
      overlay: () => overlayRef.current,
      close: (reason) => closeRef.current(reason),
      dismissOnScroll: options.dismissOnScroll ?? true,
      onScroll: () => scrollRef.current?.(),
    };
    if (active && active !== entry) active.close("replaced");
    active = entry;
    startListening();
    return () => {
      if (active === entry) active = null;
      stopScrollListeningIfIdle();
      stopListening();
    };
  }, [open, triggerRef, overlayRef, options.dismissOnScroll]);

  useEffect(() => {
    if (previousPath.current !== location.pathname && open)
      closeRef.current("route");
    previousPath.current = location.pathname;
    // A route change invalidates any contextual overlay opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}

// Data visualizations need scroll dismissal but do not participate in outside
// click or overlay ownership. Share the same single capture-phase scroll
// listener without treating their hover state as a contextual popover.
export function useDismissOnScroll(open: boolean, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => dismissRef.current();
    scrollDismissals.add(dismiss);
    startScrollListening();
    return () => {
      scrollDismissals.delete(dismiss);
      stopScrollListeningIfIdle();
    };
  }, [open]);
}
