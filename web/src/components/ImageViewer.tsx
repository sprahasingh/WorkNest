import { lockScroll } from "@/lib/scrollLock";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ImageViewerContext, type ViewerImage } from "./imageViewerContext";

const MAX_SCALE = 6;
// Letting go of a pinch below this closes the viewer.
const CLOSE_BELOW = 0.75;
const BUTTON =
  "flex h-10 min-w-10 items-center justify-center rounded-lg px-2 text-sm font-medium text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 disabled:hover:bg-transparent";

interface View {
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<ViewerImage | null>(null);
  const value = useMemo(() => ({ openImage: setImage }), []);
  const close = useCallback(() => setImage(null), []);

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      {image && <ImageViewer image={image} onClose={close} />}
    </ImageViewerContext.Provider>
  );
}

// A picture shown large over a blurred page. Zoom with the buttons, the
// mouse wheel, a double click or tap, or by pinching. Drag to move around
// once zoomed in. Close with the cross, Esc, a click outside, or by
// pinching the picture smaller than it started.
function ImageViewer({
  image,
  onClose,
}: {
  image: ViewerImage;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(FIT);
  const [gesturing, setGesturing] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const moved = useRef(false);
  // Whether the press began on the empty space rather than on the picture.
  const startedOutside = useRef(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const unlockScroll = lockScroll();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=") zoomBy(1.4);
      if (event.key === "-") zoomBy(1 / 1.4);
      if (event.key === "0") setView(FIT);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlockScroll();
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
    // zoomBy only reads refs, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // How far the picture can be moved before an edge leaves the screen.
  const limits = (scale: number) => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2),
      y: Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2),
    };
  };

  const settle = (next: View): View => {
    if (next.scale <= 1) return FIT;
    const max = limits(next.scale);
    return {
      scale: next.scale,
      x: Math.min(max.x, Math.max(-max.x, next.x)),
      y: Math.min(max.y, Math.max(-max.y, next.y)),
    };
  };

  // Zoom so the point (px, py), measured from the stage centre, stays put.
  const zoomAt = (scale: number, px: number, py: number) => {
    const current = viewRef.current;
    const clamped = Math.min(MAX_SCALE, Math.max(1, scale));
    const ratio = clamped / current.scale;
    setView(
      settle({
        scale: clamped,
        x: px - (px - current.x) * ratio,
        y: py - (py - current.y) * ratio,
      }),
    );
  };

  function zoomBy(factor: number) {
    zoomAt(viewRef.current.scale * factor, 0, 0);
  }

  const fromCentre = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    };
  };

  const onWheel = (event: ReactWheelEvent) => {
    const point = fromCentre(event.clientX, event.clientY);
    zoomAt(
      viewRef.current.scale * Math.exp(-event.deltaY * 0.002),
      point.x,
      point.y,
    );
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    moved.current = false;
    startedOutside.current =
      pointers.current.size === 1 && event.target === event.currentTarget;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: viewRef.current.scale,
      };
    }
    setGesturing(true);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      // Allow a little below 1 while pinching, so closing feels natural.
      const scale = Math.min(
        MAX_SCALE,
        Math.max(
          0.4,
          (pinch.current.scale * distance) / pinch.current.distance,
        ),
      );
      setView((current) => ({ ...current, scale }));
      return;
    }
    if (pointers.current.size === 1 && viewRef.current.scale > 1) {
      setView((current) =>
        settle({ scale: current.scale, x: current.x + dx, y: current.y + dy }),
      );
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size > 0) return;
    setGesturing(false);
    const { scale } = viewRef.current;
    if (scale < CLOSE_BELOW) {
      onClose();
    } else {
      setView((current) => settle(current));
    }
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const point = fromCentre(event.clientX, event.clientY);
    if (viewRef.current.scale > 1.05) setView(FIT);
    else zoomAt(2.5, point.x, point.y);
  };

  const percent = Math.round(view.scale * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      className="fixed inset-0 z-[70] flex flex-col bg-slate-950/60 backdrop-blur-md animate-[fade-in_160ms_ease-out] motion-reduce:animate-none"
    >
      <div className="relative z-10 flex items-center justify-between gap-3 px-3 py-3 text-white sm:px-6">
        <p className="min-w-0 truncate text-sm font-medium drop-shadow">
          {image.alt}
        </p>
        <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-slate-900/60 p-1 backdrop-blur">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.4)}
            disabled={view.scale <= 1}
            aria-label="Zoom out"
            className={BUTTON}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <line x1="6" y1="12" x2="18" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setView(FIT)}
            disabled={view.scale === 1}
            aria-label="Reset zoom"
            className={`${BUTTON} w-14 tabular-nums`}
          >
            {percent}%
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.4)}
            disabled={view.scale >= MAX_SCALE}
            aria-label="Zoom in"
            className={BUTTON}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <line x1="12" y1="6" x2="12" y2="18" />
              <line x1="6" y1="12" x2="18" y2="12" />
            </svg>
          </button>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/25" />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close picture"
            className={BUTTON}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onClick={() => {
          // A press and release on the empty space around the picture closes
          // it, but not the end of a drag or a pinch.
          if (startedOutside.current && !moved.current) onClose();
        }}
        className="flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden px-3 pb-4 sm:px-6"
        style={{
          cursor:
            view.scale > 1 ? (gesturing ? "grabbing" : "grab") : "zoom-in",
        }}
      >
        <img
          ref={imgRef}
          src={image.src}
          alt={image.alt}
          draggable={false}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl ring-1 ring-white/10"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: gesturing ? "none" : "transform 180ms ease-out",
          }}
        />
      </div>
    </div>
  );
}
