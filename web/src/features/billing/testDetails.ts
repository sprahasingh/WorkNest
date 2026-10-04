// The one thing worth copying in test mode. It is one of Razorpay's Indian
// test cards: its India test mode rejects most international ones, such as
// 4111 1111 1111 1111. The expiry, CVV and name can be anything valid.
export const TEST_CARD = "4386 2894 0766 0153";

// Copies text, and says whether it worked. Browsers can refuse (no
// permission, or not a secure page), so callers should cope with false.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const TEST_CARD_COPIED_EVENT = "worknest:test-card-copied";

// Copies the test card and tells the test box on the page, so its button can
// show "Copied" even when the copy was started from somewhere else (pressing
// Upgrade, or the failed-payment message).
export async function copyTestCard(): Promise<boolean> {
  const ok = await copyText(TEST_CARD);
  if (ok) window.dispatchEvent(new Event(TEST_CARD_COPIED_EVENT));
  return ok;
}
