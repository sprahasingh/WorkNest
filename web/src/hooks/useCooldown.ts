import { useCallback, useEffect, useState } from "react";

// A countdown for "resend" buttons: start it after sending, and the button
// stays disabled until it reaches zero.
export function useCooldown(seconds: number) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  const start = useCallback(() => setLeft(seconds), [seconds]);
  return { left, start };
}
