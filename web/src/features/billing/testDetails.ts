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
