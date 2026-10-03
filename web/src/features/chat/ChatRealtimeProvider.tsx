import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMatch, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { apiClient, getAccessToken } from "@/api/client";
import { useAuth } from "@/auth/auth-context";
import { useOrg } from "@/hooks/useOrg";
import type { Conversation } from "./api";
import { playChime, readAlertPrefs, showDesktopAlert } from "./chatPrefs";
import { chatKeys } from "./queries";
import { TabAlerts } from "./TabAlerts";
import { ChatRealtimeContext, type ChatRealtimeValue } from "./realtimeContext";

interface ChatEvent {
  orgId: string;
  kind: "message" | "updated" | "deleted" | "read" | "conversation";
  conversationId: string;
  messageId?: string | null;
  senderId?: string;
  senderName?: string;
  preview?: string;
  mentions?: string[];
  silent?: boolean;
}

const TYPING_VISIBLE_MS = 4_000;
const TYPING_SEND_EVERY_MS = 2_500;

// Vercel can't pass websockets through its /api rewrite, so production
// connects straight to the API at VITE_SOCKET_URL. Without it the app still
// works, refreshing on a timer instead. In development the Vite proxy
// handles it.
function socketTarget(): string | undefined | null {
  const configured = import.meta.env.VITE_SOCKET_URL as string | undefined;
  if (configured) return configured;
  return import.meta.env.DEV ? undefined : null;
}

export function ChatRealtimeProvider({ children }: { children: ReactNode }) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openThread = useMatch("/orgs/:orgId/messages/:conversationId");
  const openConversationId = openThread?.params.conversationId ?? null;
  const openConversationRef = useRef<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState<Record<string, string[]>>({});
  const socketRef = useRef<Socket | null>(null);
  const typingTimers = useRef(new Map<string, number>());
  const lastTypingSent = useRef(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    openConversationRef.current = openConversationId;
  }, [openConversationId]);

  useEffect(() => {
    const target = socketTarget();
    if (target === null || !userId) return;

    const socket = io(target, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: (callback) => callback({ token: getAccessToken() }),
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;
    const timers = typingTimers.current;

    const refreshChat = (conversationId?: string) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(orgId),
      });
      if (conversationId) {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.messages(orgId, conversationId),
        });
      }
    };

    socket.on("connect", () => {
      setConnected(true);
      // Catch up on anything missed while the connection was down.
      void queryClient.invalidateQueries({
        queryKey: chatKeys.all(orgId),
      });
    });
    socket.on("disconnect", () => setConnected(false));
    let retryTimer: number | undefined;
    socket.on("connect_error", () => {
      setConnected(false);
      // Socket.IO doesn't retry on its own when the server turns a connection
      // away, which is what an expired token does. Any API call renews the
      // token, so make one and then connect again.
      window.clearTimeout(retryTimer);
      void apiClient
        .get(`/orgs/${orgId}/chat/config`)
        .catch(() => undefined)
        .finally(() => {
          retryTimer = window.setTimeout(() => {
            if (!socket.active) socket.connect();
          }, 3_000);
        });
    });

    socket.on("chat:event", (event: ChatEvent) => {
      if (event.orgId !== orgId) return;
      refreshChat(event.conversationId);

      const fromSomeoneElse = event.senderId !== userId;
      if (event.kind !== "message" || event.silent || !fromSomeoneElse) return;

      // A muted chat only gets through when someone mentions you in it.
      const known = queryClient.getQueryData<{
        conversations: Conversation[];
      }>(chatKeys.conversations(orgId));
      const muted =
        known?.conversations.find((c) => c.id === event.conversationId)
          ?.muted ?? false;
      const mentionedMe = event.mentions?.includes(userId) ?? false;
      if (muted && !mentionedMe) return;

      const watching =
        openConversationRef.current === event.conversationId &&
        document.visibilityState === "visible";
      if (watching) return;

      const title = mentionedMe
        ? `${event.senderName ?? "Someone"} mentioned you`
        : (event.senderName ?? "New message");
      const open = () =>
        void navigate(`/orgs/${orgId}/messages/${event.conversationId}`);
      const prefs = readAlertPrefs();
      if (document.visibilityState === "visible") {
        toast(title, {
          description: event.preview,
          action: { label: "Open", onClick: open },
        });
      } else if (prefs.desktop) {
        showDesktopAlert(title, event.preview ?? "", open);
      }
      if (prefs.sound) playChime();
    });

    socket.on(
      "chat:typing",
      (event: { orgId: string; conversationId: string; userId: string }) => {
        if (event.orgId !== orgId) return;
        const key = `${event.conversationId}:${event.userId}`;
        window.clearTimeout(timers.get(key));
        setTyping((current) => {
          const typists = current[event.conversationId] ?? [];
          return typists.includes(event.userId)
            ? current
            : {
                ...current,
                [event.conversationId]: [...typists, event.userId],
              };
        });
        timers.set(
          key,
          window.setTimeout(() => {
            timers.delete(key);
            setTyping((current) => {
              const rest = (current[event.conversationId] ?? []).filter(
                (id) => id !== event.userId,
              );
              return { ...current, [event.conversationId]: rest };
            });
          }, TYPING_VISIBLE_MS),
        );
      },
    );

    return () => {
      window.clearTimeout(retryTimer);
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setTyping({});
    };
  }, [orgId, userId, queryClient, navigate]);

  const sendTyping = useCallback(
    (conversationId: string) => {
      const now = Date.now();
      if (now - lastTypingSent.current < TYPING_SEND_EVERY_MS) return;
      lastTypingSent.current = now;
      socketRef.current?.emit("chat:typing", { orgId, conversationId });
    },
    [orgId],
  );

  const value = useMemo<ChatRealtimeValue>(
    () => ({ connected, typing, sendTyping }),
    [connected, typing, sendTyping],
  );

  return (
    <ChatRealtimeContext.Provider value={value}>
      <TabAlerts />
      {children}
    </ChatRealtimeContext.Provider>
  );
}
