import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { InfoButton, InfoPanel } from "./InfoToggle";

function InfoExample() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <InfoButton
        open={open}
        onToggle={() => setOpen((value) => !value)}
        label="About retention"
        controls="retention-help"
      />
      <InfoPanel id="retention-help" open={open} onClose={() => setOpen(false)}>
        <p>Messages are retained for the configured period.</p>
        <button type="button">Interactive preference</button>
      </InfoPanel>
      <button type="button">Outside</button>
    </MemoryRouter>
  );
}

describe("InfoPanel contextual lifecycle", () => {
  afterEach(cleanup);

  it("opens from its trigger, permits inside controls, and closes outside or on Escape", () => {
    render(<InfoExample />);
    const trigger = screen.getByRole("button", { name: "About retention" });
    fireEvent.click(trigger);
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Interactive preference" }),
    );
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }), {
      pointerType: "touch",
    });
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
  });

  it("stays closed after touch scrolling and ignores its synthetic click", () => {
    render(<InfoExample />);
    const trigger = screen.getByRole("button", { name: "About retention" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.scroll(window);
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger);
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
  });
});
