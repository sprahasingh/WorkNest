import { useEffect } from "react";
import { useOrg } from "@/hooks/useOrg";
import { useChatUnreadCount } from "./queries";

const BADGE_COLOUR = "#dc2626";

// Puts the unread count in the browser tab: "(3) WorkNest" in the title and a
// small red dot on the favicon. Renders nothing.
export function TabAlerts() {
  const { orgId } = useOrg();
  const unread = useChatUnreadCount(orgId);

  useEffect(() => {
    const baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title =
      unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${baseTitle}` : baseTitle;
    return () => {
      document.title = baseTitle;
    };
  }, [unread]);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    const original = link.dataset.original ?? link.href;
    link.dataset.original = original;
    if (unread === 0) {
      link.href = original;
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, 64, 64);
      context.beginPath();
      context.arc(48, 16, 14, 0, Math.PI * 2);
      context.fillStyle = BADGE_COLOUR;
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = "#ffffff";
      context.stroke();
      try {
        link.href = canvas.toDataURL("image/png");
      } catch {
        // A tainted canvas means the icon came from another origin; the title
        // count still shows.
      }
    };
    image.src = original;
    return () => {
      cancelled = true;
      link.href = original;
    };
  }, [unread]);

  return null;
}
