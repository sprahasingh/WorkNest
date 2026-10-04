import { useCallback, useEffect, useRef, type PointerEvent } from "react";

const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE_PX = 8;

type Open<T> = (target: T, x: number, y: number, touch: boolean) => void;

// Opens a menu from a long press on a touch screen or a right click with a
// mouse. Bind the returned handlers to the thing being pressed. A press that
// opened the menu shouldn't also count as a tap, so check `wasLongPress` at
// the start of the click handler.
export function useLongPress<T>(open: Open<T>) {
  const press = useRef<{
    timer: number;
    x: number;
    y: number;
    fired: boolean;
    firedAt: number;
  } | null>(null);

  const cancel = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
  }, []);
  useEffect(() => cancel, [cancel]);

  // True once for the click that follows a long press.
  const wasLongPress = useCallback(() => {
    if (!press.current?.fired) return false;
    press.current.fired = false;
    return true;
  }, []);

  const handlersFor = useCallback(
    (target: T) => ({
      onPointerDown: (event: PointerEvent) => {
        if (event.pointerType === "mouse") return;
        cancel();
        const x = event.clientX;
        const y = event.clientY;
        press.current = {
          x,
          y,
          fired: false,
          firedAt: 0,
          timer: window.setTimeout(() => {
            if (!press.current) return;
            press.current.fired = true;
            press.current.firedAt = Date.now();
            navigator.vibrate?.(10);
            open(target, x, y, true);
          }, LONG_PRESS_MS),
        };
      },
      onPointerMove: (event: PointerEvent) => {
        const current = press.current;
        if (!current || current.fired) return;
        if (
          Math.abs(event.clientX - current.x) > MOVE_TOLERANCE_PX ||
          Math.abs(event.clientY - current.y) > MOVE_TOLERANCE_PX
        ) {
          cancel();
        }
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (event: {
        preventDefault: () => void;
        clientX: number;
        clientY: number;
      }) => {
        event.preventDefault();
        // On a phone the long press has opened the menu already.
        if (press.current && Date.now() - press.current.firedAt < 900) return;
        const touch = window.matchMedia("(pointer: coarse)").matches;
        open(target, event.clientX, event.clientY, touch);
      },
    }),
    [cancel, open],
  );

  return { handlersFor, wasLongPress };
}
