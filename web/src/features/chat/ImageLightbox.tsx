import { useEffect, useRef } from "react";

interface ImageLightboxProps {
  image: { url: string; name: string } | null;
  onClose: () => void;
}

// A larger view of a picture from a message, closed with Esc or a click
// outside it.
export function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!image) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 pb-3 text-white">
        <p className="min-w-0 truncate text-sm font-medium">{image.name}</p>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={image.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-white/15"
          >
            Open original
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close picture"
            className="rounded-lg p-2 hover:bg-white/15"
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
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <img
          src={image.url}
          alt={image.name}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}
