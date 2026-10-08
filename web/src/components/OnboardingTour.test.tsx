import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { OnboardingTour } from "./OnboardingTour";
import { calculateTourPosition } from "./onboardingTourPosition";

describe("onboarding tour positioning", () => {
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

  it("shows managers their dashboard but not the admin audit log", () => {
    renderTour("manager");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Explore dashboard →")).toBeTruthy();
    expect(screen.queryByText("Explore audit log →")).toBeNull();
  });

  it("shows dashboard and audit access to admins", () => {
    renderTour("admin");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Explore dashboard →")).toBeTruthy();
    for (let index = 0; index < 6; index += 1) {
      if (screen.queryByText("Explore audit log →")) break;
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByText("Explore audit log →")).toBeTruthy();
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
