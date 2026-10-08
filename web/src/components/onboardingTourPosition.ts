export type TourRect = Pick<
  DOMRect,
  "top" | "right" | "bottom" | "left" | "width" | "height"
>;

export interface TourViewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Scroll the tour's section heading below sticky navigation and restore its inline style later. */
export function scrollTourSectionToStart(
  target: HTMLElement,
  sectionStart?: HTMLElement | null,
) {
  const heading =
    sectionStart ??
    (target.matches("h1, h2, h3")
      ? target
      : target
          .closest("section, article")
          ?.querySelector<HTMLElement>("h1, h2, h3")) ??
    target.querySelector<HTMLElement>("h1, h2, h3") ??
    target;
  const previousScrollMarginTop = heading.style.scrollMarginTop;
  heading.style.scrollMarginTop = "calc(env(safe-area-inset-top) + 5rem)";
  heading.scrollIntoView({
    behavior: "instant",
    block: "start",
    inline: "nearest",
  });
  return () => {
    heading.style.scrollMarginTop = previousScrollMarginTop;
  };
}

export function calculateTourPosition(
  target: TourRect | null,
  card: Pick<TourRect, "width" | "height">,
  viewport: TourViewport,
) {
  const margin = 12;
  const isMobile = viewport.width < 640;
  const maxHeight = Math.max(
    0,
    Math.min(
      viewport.height - margin * 2,
      viewport.height * (isMobile ? 0.5 : 0.65),
      isMobile ? 360 : 480,
    ),
  );
  const cardHeight = Math.min(card.height, maxHeight);
  const cardWidth = Math.min(
    card.width || (isMobile ? viewport.width - 24 : 384),
    viewport.width - margin * 2,
  );
  const clampLeft = (left: number) =>
    Math.min(
      Math.max(viewport.left + margin, left),
      viewport.left + viewport.width - cardWidth - margin,
    );
  const clampTop = (top: number) =>
    Math.min(
      Math.max(viewport.top + margin, top),
      viewport.top + viewport.height - cardHeight - margin,
    );

  if (!target) {
    return {
      top: clampTop(viewport.top + (viewport.height - cardHeight) / 2),
      left: clampLeft(viewport.left + (viewport.width - cardWidth) / 2),
      maxHeight,
    };
  }

  const centeredLeft = clampLeft(
    target.left + target.width / 2 - cardWidth / 2,
  );
  const fitsBelow =
    viewport.top + viewport.height - margin - target.bottom - margin >=
    cardHeight;
  const fitsAbove = target.top - viewport.top - margin * 2 >= cardHeight;
  let top: number;
  let left = centeredLeft;
  if (fitsBelow) {
    top = target.bottom + margin;
  } else if (fitsAbove) {
    top = target.top - cardHeight - margin;
  } else if (!isMobile) {
    const rightSpace =
      viewport.left + viewport.width - target.right - margin * 2;
    const leftSpace = target.left - viewport.left - margin * 2;
    if (rightSpace >= cardWidth || leftSpace >= cardWidth) {
      left =
        rightSpace >= cardWidth
          ? target.right + margin
          : target.left - cardWidth - margin;
      top = clampTop(target.top + target.height / 2 - cardHeight / 2);
    } else {
      top =
        target.top > viewport.top + viewport.height / 2
          ? viewport.top + margin
          : viewport.top + viewport.height - cardHeight - margin;
    }
  } else {
    top = viewport.top + viewport.height - cardHeight - margin;
  }
  return { top: clampTop(top), left: clampLeft(left), maxHeight };
}
