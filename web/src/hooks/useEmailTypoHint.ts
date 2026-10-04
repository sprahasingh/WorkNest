import { useState } from "react";
import { suggestEmail } from "@/lib/emailTypos";

// Waits until the person leaves the field, so the hint never nags in the
// middle of typing.
export function useEmailTypoHint(value: string) {
  const [checked, setChecked] = useState("");
  const suggestion = checked === value ? suggestEmail(value) : null;
  return {
    suggestion,
    check: () => setChecked(value),
  };
}
