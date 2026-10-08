import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { OnboardingTour } from "./OnboardingTour";
import {
  calculateTourPosition,
  scrollTourSectionToStart,
} from "./onboardingTourPosition";

describe("onboarding tour positioning", () => {
  it("starts at the section heading below sticky navigation and restores its style", () => {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    const target = document.createElement("button");
    section.append(heading, target);
    document.body.append(section);
    const scrollIntoView = vi.fn();
    heading.scrollIntoView = scrollIntoView;

    const restore = scrollTourSectionToStart(target);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
      inline: "nearest",
    });
    expect(heading.style.scrollMarginTop).toContain("5rem");
    expect(heading.style.scrollMarginTop).toContain("env(safe-area-inset-top)");
    restore();
    expect(heading.style.scrollMarginTop).toBe("");
    section.remove();
  });

  it("uses an explicit section heading when the highlighted target is deep inside it", () => {
    const heading = document.createElement("h2");
    const target = document.createElement("button");
    const scrollIntoView = vi.fn();
    heading.scrollIntoView = scrollIntoView;

    const restore = scrollTourSectionToStart(target, heading);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(target.style.scrollMarginTop).toBe("");
    restore();
  });

  it("keeps a phone callout inside the visual viewport near the left edge", () => {
    const position = calculateTourPosition(
      { top: 72, left: 0, right: 48, bottom: 112, width: 48, height: 40 },
      { width: 296, height: 220 },
      { top: 24, left: 0, width: 320, height: 520 },
    );

    expect(position.left).toBe(12);
    expect(position.top).toBe(124);
    expect(position.top + 220).toBeLessThanOrEqual(24 + 520 - 12);
  });

  it("places a callout above a target near the bottom edge", () => {
    const position = calculateTourPosition(
      { top: 500, left: 120, right: 220, bottom: 540, width: 100, height: 40 },
      { width: 380, height: 240 },
      { top: 0, left: 0, width: 1024, height: 600 },
    );

    expect(position.top + 240).toBeLessThan(500);
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.left + 380).toBeLessThanOrEqual(1024 - 12);
  });

  it("anchors a compact card within the visual viewport when space is tight", () => {
    const position = calculateTourPosition(
      { top: 260, left: 120, right: 200, bottom: 310, width: 80, height: 50 },
      { width: 296, height: 480 },
      { top: 30, left: 0, width: 320, height: 500 },
    );

    expect(position.maxHeight).toBe(250);
    expect(position.top + position.maxHeight).toBe(30 + 500 - 12);
    expect(position.left).toBe(12);
  });
});

function renderTour(role: "admin" | "manager" | "member") {
  return render(
    <MemoryRouter>
      <OnboardingTour
        role={role}
        orgId="org-1"
        orgName="Acme"
        onClose={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe("role-aware onboarding tour", () => {
  afterEach(cleanup);

  it("does not show dashboard access to members", () => {
    renderTour("member");
    expect(screen.queryByText("Explore dashboard →")).toBeNull();
    expect(screen.queryByText("Explore audit log →")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Go to previous tour step" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows managers their dashboard but not admin organization tours", () => {
    renderTour("manager");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Explore dashboard →")).toBeTruthy();
    expect(screen.queryByText("Explore organization activity →")).toBeNull();
    expect(screen.queryByText("Explore Organization Settings →")).toBeNull();
  });

  it("orders admin activity, organization settings, and Settings tours", () => {
    renderTour("admin");
    for (let index = 0; index < 6; index += 1)
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Explore organization activity →")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Explore Organization Settings →")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Explore Settings →")).toBeTruthy();
  });

  it.each([
    ["manager", 6],
    ["member", 5],
  ] as const)(
    "gives %s the general Settings tour without admin tours",
    (role, steps) => {
      renderTour(role);
      for (let index = 0; index < steps; index += 1)
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Explore Settings →")).toBeTruthy();
      expect(screen.queryByText("Explore organization activity →")).toBeNull();
      expect(screen.queryByText("Explore Organization Settings →")).toBeNull();
    },
  );

  it("covers Organization Settings in page order", () => {
    renderTour("admin");
    for (let index = 0; index < 7; index += 1)
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByText("Explore Organization Settings →"));
    expect(
      screen.getByRole("heading", {
        name: "Organization details and retention",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Plans, limits, and billing" }),
    ).toBeTruthy();
  });

  it("covers the general Settings profile and email sections with Back navigation", () => {
    renderTour("member");
    for (let index = 0; index < 5; index += 1)
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByText("Explore Settings →"));
    expect(
      screen.getByRole("heading", {
        name: "Personal information and security",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Email address" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(
      screen.getByRole("heading", {
        name: "Personal information and security",
      }),
    ).toBeTruthy();
  });

  it("supports going back within a page tour", () => {
    renderTour("member");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByText("Explore Projects →"));
    expect(screen.getByText("Project lists")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Sort projects")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText("Project lists")).toBeTruthy();
  });

  it("keeps page-tour navigation available when the target is missing", () => {
    renderTour("member");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByText("Explore Projects →"));

    expect(screen.getByRole("dialog", { name: "Project lists" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Sort projects")).toBeTruthy();
  });
});
