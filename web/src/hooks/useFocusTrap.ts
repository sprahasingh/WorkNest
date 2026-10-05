import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// For panels and drawers that cover the page: focus moves in, Tab stays
// inside, Escape closes it, and focus returns to what opened it. Only the
// top-most overlay reacts, so a dialog opened over a drawer isn't closed by
// the same key press.
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.getClientRects().length > 0,
      );
    if (!element.contains(document.activeElement)) {
      (items()[0] ?? element).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const overlays = document.querySelectorAll('[aria-modal="true"]');
      if (overlays.length > 0 && overlays[overlays.length - 1] !== element) {
        return;
      }
      if (event.key === "Escape") {
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        event.preventDefault();
        element.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === element)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [ref, active]);
}
