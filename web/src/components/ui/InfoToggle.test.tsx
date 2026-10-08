import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { InfoButton, InfoPanel } from "./InfoToggle";

function InfoExample() {
  const [open, setOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);
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
      <InfoButton
        open={secondOpen}
        onToggle={() => setSecondOpen((value) => !value)}
        label="About dates"
        controls="date-help"
      />
      <InfoPanel
        id="date-help"
        open={secondOpen}
        onClose={() => setSecondOpen(false)}
      >
        <p>Dates use the organization time zone.</p>
      </InfoPanel>
      <button type="button">Outside</button>
      <Link to="/next">Navigate</Link>
    </MemoryRouter>
  );
}

function setTriggerRect(trigger: HTMLElement, top: number) {
  trigger.getBoundingClientRect = () => new DOMRect(40, top, 28, 28);
}

describe("InfoPanel contextual lifecycle", () => {
  afterEach(cleanup);

  it("opens from its trigger, permits inside controls, and closes outside or on Escape", () => {
    let parentDialogReceivedEscape = false;
    render(
      <div
        role="dialog"
        onKeyDown={() => {
          parentDialogReceivedEscape = true;
        }}
      >
        <InfoExample />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "About retention" });
    fireEvent.click(trigger);
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Interactive preference" }),
    );
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
    expect(parentDialogReceivedEscape).toBe(false);
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }), {
      pointerType: "touch",
    });
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
  });

  it("has a large, accessible close button and returns focus to the trigger", () => {
    render(<InfoExample />);
    const trigger = screen.getByRole("button", { name: "About retention" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close information" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger).toBe(document.activeElement);
  });

  it("repositions on page scroll and closes after the trigger leaves the viewport", async () => {
    render(<InfoExample />);
    const trigger = screen.getByRole("button", { name: "About retention" });
    setTriggerRect(trigger, 100);
    fireEvent.click(trigger);
    const panel = screen.getByRole("note");
    expect(panel.style.top).toBe("136px");

    setTriggerRect(trigger, 180);
    fireEvent.scroll(window);
    await waitFor(() => expect(panel.style.top).toBe("216px"));

    setTriggerRect(trigger, -80);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole("note")).toBeNull());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open when scrolling inside its content", async () => {
    render(<InfoExample />);
    const trigger = screen.getByRole("button", { name: "About retention" });
    setTriggerRect(trigger, 100);
    fireEvent.click(trigger);
    const panel = screen.getByRole("note");
    const content = panel.querySelector(".overflow-y-auto");
    expect(content).toBeTruthy();
    fireEvent.scroll(content!);
    await waitFor(() => expect(screen.getByRole("note")).toBeTruthy());
  });

  it("closes the previous panel when another information panel opens", () => {
    render(<InfoExample />);
    fireEvent.click(screen.getByRole("button", { name: "About retention" }));
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About dates" }));
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
    expect(screen.getByText(/organization time zone/)).toBeTruthy();
  });

  it("closes on route changes", async () => {
    render(<InfoExample />);
    fireEvent.click(screen.getByRole("button", { name: "About retention" }));
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    await waitFor(() =>
      expect(screen.queryByText(/Messages are retained/)).toBeNull(),
    );
  });

  it("stays open while scrolling its explanation and ignores the synthetic click", () => {
    render(<InfoExample />);
    const trigger = screen.getByRole("button", { name: "About retention" });
    setTriggerRect(trigger, 100);
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.scroll(window);
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByText(/Messages are retained/)).toBeTruthy();
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger);
    expect(screen.queryByText(/Messages are retained/)).toBeNull();
  });
});
