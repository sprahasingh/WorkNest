import { createContext, useContext } from "react";

export interface ChatRealtimeValue {
  // True while the live connection is up. When it isn't, screens fall back
  // to refreshing on a timer.
  connected: boolean;
  // People currently typing, by conversation id.
  typing: Record<string, string[]>;
  sendTyping: (conversationId: string) => void;
}

export const ChatRealtimeContext = createContext<ChatRealtimeValue>({
  connected: false,
  typing: {},
  sendTyping: () => undefined,
});

export function useChatRealtime(): ChatRealtimeValue {
  return useContext(ChatRealtimeContext);
}
