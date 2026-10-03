// Alerts for new messages are off until someone turns them on. The choice is
// kept per browser, so it's stored here rather than on the account.
const KEY = "worknest.chat.alerts";

export interface ChatAlertPrefs {
  desktop: boolean;
  sound: boolean;
}

const DEFAULTS: ChatAlertPrefs = { desktop: false, sound: false };

export function readAlertPrefs(): ChatAlertPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ChatAlertPrefs>;
    return { desktop: parsed.desktop === true, sound: parsed.sound === true };
  } catch {
    return DEFAULTS;
  }
}

export function writeAlertPrefs(prefs: ChatAlertPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
    window.dispatchEvent(new Event("worknest:chat-alerts"));
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts until
    // the page is closed.
  }
}

export function desktopAlertsAvailable(): boolean {
  return typeof Notification !== "undefined";
}

// A short, soft two-note chime made in the browser, so there's no file to load.
export function playChime(): void {
  try {
    const context = new AudioContext();
    const now = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.08, now + index * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + 0.3);
    });
    window.setTimeout(() => void context.close(), 800);
  } catch {
    // Some browsers block sound until the page has been used; that's fine.
  }
}

export function showDesktopAlert(
  title: string,
  body: string,
  onClick: () => void,
): void {
  if (!desktopAlertsAvailable() || Notification.permission !== "granted") {
    return;
  }
  try {
    const alert = new Notification(title, { body, tag: "worknest-chat" });
    alert.onclick = () => {
      window.focus();
      onClick();
      alert.close();
    };
  } catch {
    // Some mobile browsers only allow these from a service worker.
  }
}
