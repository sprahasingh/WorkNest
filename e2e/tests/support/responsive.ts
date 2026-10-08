import { expect, type Page } from "@playwright/test";

export const RESPONSIVE_VIEWPORTS = [
  { name: "very small phone", width: 320, height: 568 },
  { name: "standard phone", width: 375, height: 667 },
  { name: "modern phone", width: 390, height: 844 },
  { name: "large phone", width: 430, height: 932 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "small laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "full HD display", width: 1920, height: 1080 },
  { name: "QHD display", width: 2560, height: 1440 },
  { name: "ultrawide display", width: 3440, height: 1440 },
  { name: "4K display", width: 3840, height: 2160 },
] as const;

const smokeWidths = new Set([320, 390, 768, 1280, 1920]);
export const RESPONSIVE_SMOKE_VIEWPORTS = RESPONSIVE_VIEWPORTS.filter(
  ({ width }) => smokeWidths.has(width),
);

export function responsiveViewport(width: number) {
  const viewport = RESPONSIVE_VIEWPORTS.find((item) => item.width === width);
  if (!viewport)
    throw new Error(`No shared responsive viewport for ${width}px`);
  return viewport;
}

// Tailwind CSS 4's default sm, md, lg, xl, and 2xl transitions, sampled on
// both sides to catch width-specific wrapping and visibility regressions.
export const RESPONSIVE_BREAKPOINT_VIEWPORTS = [
  { name: "below sm", width: 639, height: 800 },
  { name: "at sm", width: 640, height: 800 },
  { name: "below md", width: 767, height: 900 },
  { name: "at md", width: 768, height: 900 },
  { name: "below lg", width: 1023, height: 900 },
  { name: "at lg", width: 1024, height: 900 },
  { name: "below xl", width: 1279, height: 900 },
  { name: "at xl", width: 1280, height: 900 },
  { name: "below 2xl", width: 1535, height: 900 },
  { name: "at 2xl", width: 1536, height: 900 },
] as const;

export const RESPONSIVE_SHORT_VIEWPORTS = [
  { name: "phone short", width: 320, height: 568 },
  { name: "phone compact", width: 390, height: 667 },
  { name: "tablet short", width: 768, height: 600 },
  { name: "small laptop short", width: 1024, height: 600 },
  { name: "laptop short", width: 1280, height: 720 },
  { name: "desktop short", width: 1920, height: 600 },
] as const;

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.page,
    `${label} horizontal page overflow`,
  ).toBeLessThanOrEqual(dimensions.viewport);
}

export async function expectWithinViewport(
  page: Page,
  selector: string,
  width: number,
  height: number,
) {
  const bounds = await page.locator(selector).boundingBox();
  expect(bounds, `${selector} should have visible bounds`).toBeTruthy();
  expect(bounds!.x, `${selector} left edge`).toBeGreaterThanOrEqual(0);
  expect(bounds!.y, `${selector} top edge`).toBeGreaterThanOrEqual(0);
  expect(
    bounds!.x + bounds!.width,
    `${selector} right edge`,
  ).toBeLessThanOrEqual(width);
  expect(
    bounds!.y + bounds!.height,
    `${selector} bottom edge`,
  ).toBeLessThanOrEqual(height);
}

export async function expectTouchTarget(locator: ReturnType<Page["locator"]>) {
  const bounds = await locator.boundingBox();
  expect(bounds?.height, "touch target height").toBeGreaterThanOrEqual(44);
  expect(bounds?.width, "touch target width").toBeGreaterThanOrEqual(44);
}
