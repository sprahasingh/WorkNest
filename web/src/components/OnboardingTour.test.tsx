import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { OnboardingTour } from "./OnboardingTour";

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
});
