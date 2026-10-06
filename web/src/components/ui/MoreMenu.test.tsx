import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { MoreMenu, MoreMenuItem } from "./MoreMenu";

function menus() {
  return render(
    <MemoryRouter>
      <MoreMenu label="First">
        <MoreMenuItem>First action</MoreMenuItem>
      </MoreMenu>
      <MoreMenu label="Second">
        <MoreMenuItem>Second action</MoreMenuItem>
      </MoreMenu>
      <button>Outside</button>
    </MemoryRouter>,
  );
}

describe("MoreMenu contextual dismissal", () => {
  afterEach(cleanup);
  it("toggles, closes outside and on Escape, and preserves action selection", () => {
    menus();
    const trigger = screen.getByLabelText("First actions");
    fireEvent.click(trigger);
    expect(screen.getByText("First action")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByText("First action")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("First action")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("First action"));
    expect(screen.queryByText("First action")).toBeNull();
  });

  it("closes on outside touch and when another menu opens", () => {
    menus();
    fireEvent.click(screen.getByLabelText("First actions"));
    fireEvent.click(screen.getByLabelText("Second actions"));
    expect(screen.queryByText("First action")).toBeNull();
    expect(screen.getByText("Second action")).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("Outside"), {
      pointerType: "touch",
    });
    expect(screen.queryByText("Second action")).toBeNull();
  });

  it("stays closed after scroll and ignores the following synthetic click", () => {
    menus();
    const trigger = screen.getByLabelText("First actions");
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.scroll(window);
    expect(screen.queryByText("First action")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByText("First action")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByText("First action")).toBeTruthy();
  });

  it("closes when the route changes", () => {
    render(
      <MemoryRouter>
        <MoreMenu label="Route menu">
          <MoreMenuItem>Route action</MoreMenuItem>
        </MoreMenu>
        <Link to="/next">Navigate</Link>
        <Routes>
          <Route path="/" element={<span>Current page</span>} />
          <Route path="/next" element={<span>Next page</span>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText("Route menu actions"));
    expect(screen.getByText("Route action")).toBeTruthy();
    fireEvent.click(screen.getByText("Navigate"));
    expect(screen.getByText("Next page")).toBeTruthy();
    expect(screen.queryByText("Route action")).toBeNull();
  });
});
