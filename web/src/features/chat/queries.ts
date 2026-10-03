import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  addGroupMembers,
  createGroup,
  deleteMessage,
  editMessage,
  getChatConfig,
  getPresence,
  listConversations,
  listMessages,
  markConversationRead,
  reactToMessage,
  searchMessages,
  setConversationMuted,
  removeGroupMember,
  renameGroup,
  sendMessage,
  startDirectChat,
  type ChatMessage,
  type MessagePage,
  type UploadedAttachment,
} from "./api";
import { useChatRealtime } from "./realtimeContext";

const FALLBACK_LIST_POLL_MS = 15_000;
const FALLBACK_THREAD_POLL_MS = 5_000;
const PRESENCE_POLL_MS = 30_000;

export const chatKeys = {
  all: (orgId: string) => ["orgs", orgId, "chat"] as const,
  conversations: (orgId: string) =>
    [...chatKeys.all(orgId), "conversations"] as const,
  messages: (orgId: string, conversationId: string) =>
    [...chatKeys.all(orgId), "messages", conversationId] as const,
  config: (orgId: string) => [...chatKeys.all(orgId), "config"] as const,
  presence: (orgId: string) => [...chatKeys.all(orgId), "presence"] as const,
};

export function useConversations(orgId: string) {
  const { connected } = useChatRealtime();
  return useQuery({
    queryKey: chatKeys.conversations(orgId),
    queryFn: () => listConversations(orgId),
    refetchInterval: connected ? false : FALLBACK_LIST_POLL_MS,
  });
}

export function useChatUnreadCount(orgId: string): number {
  return useConversations(orgId).data?.unreadCount ?? 0;
}

export function useChatConfig(orgId: string) {
  return useQuery({
    queryKey: chatKeys.config(orgId),
    queryFn: () => getChatConfig(orgId),
    staleTime: 10 * 60_000,
  });
}

export function usePresence(orgId: string) {
  return useQuery({
    queryKey: chatKeys.presence(orgId),
    queryFn: () => getPresence(orgId),
    refetchInterval: PRESENCE_POLL_MS,
    select: (ids) => new Set(ids),
  });
}

export function useMessages(orgId: string, conversationId: string) {
  const { connected } = useChatRealtime();
  return useInfiniteQuery({
    queryKey: chatKeys.messages(orgId, conversationId),
    queryFn: ({ pageParam }) => listMessages(orgId, conversationId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: connected ? false : FALLBACK_THREAD_POLL_MS,
  });
}

type MessagesData = InfiniteData<MessagePage, string | undefined>;

// Newest page first in the cache; the screen wants oldest first.
export function flattenMessages(
  data: InfiniteData<MessagePage, unknown> | undefined,
): ChatMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((page) => page.messages);
}

function patchMessage(
  data: MessagesData | undefined,
  message: ChatMessage,
): MessagesData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((existing) =>
        existing.id === message.id ? message : existing,
      ),
    })),
  };
}

export function useChatMutations(orgId: string, conversationId: string) {
  const queryClient = useQueryClient();
  const messagesKey = chatKeys.messages(orgId, conversationId);
  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: chatKeys.conversations(orgId) });

  const send = useMutation({
    mutationFn: (input: {
      text: string;
      replyToId?: string;
      mentionIds?: string[];
      attachments?: UploadedAttachment[];
    }) => sendMessage(orgId, conversationId, input),
    onSuccess: (message) => {
      // Show it straight away; the refetch that follows keeps it in sync.
      queryClient.setQueryData<MessagesData>(messagesKey, (data) => {
        if (!data || data.pages.length === 0) return data;
        const [latest, ...older] = data.pages;
        if (latest.messages.some((m) => m.id === message.id)) return data;
        return {
          ...data,
          pages: [
            { ...latest, messages: [...latest.messages, message] },
            ...older,
          ],
        };
      });
      void refreshList();
    },
  });

  const edit = useMutation({
    mutationFn: ({ messageId, text }: { messageId: string; text: string }) =>
      editMessage(orgId, messageId, text),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagesData>(messagesKey, (data) =>
        patchMessage(data, message),
      );
      void refreshList();
    },
  });

  const remove = useMutation({
    mutationFn: (messageId: string) => deleteMessage(orgId, messageId),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagesData>(messagesKey, (data) =>
        patchMessage(data, message),
      );
      void refreshList();
    },
  });

  const react = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      reactToMessage(orgId, messageId, emoji),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagesData>(messagesKey, (data) =>
        patchMessage(data, message),
      );
    },
  });

  const markRead = useMutation({
    mutationFn: () => markConversationRead(orgId, conversationId),
    onSuccess: () => void refreshList(),
  });

  return { send, edit, remove, react, markRead };
}

export function useStartDirectChat(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => startDirectChat(orgId, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(orgId),
      }),
  });
}

export function useCreateGroup(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; memberIds: string[] }) =>
      createGroup(orgId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(orgId),
      }),
  });
}

export function useGroupMutations(orgId: string, conversationId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: chatKeys.conversations(orgId),
    });
    void queryClient.invalidateQueries({
      queryKey: chatKeys.messages(orgId, conversationId),
    });
  };

  return {
    rename: useMutation({
      mutationFn: (name: string) => renameGroup(orgId, conversationId, name),
      onSuccess: refresh,
    }),
    addMembers: useMutation({
      mutationFn: (userIds: string[]) =>
        addGroupMembers(orgId, conversationId, userIds),
      onSuccess: refresh,
    }),
    removeMember: useMutation({
      mutationFn: (userId: string) =>
        removeGroupMember(orgId, conversationId, userId),
      onSuccess: refresh,
    }),
  };
}

export function useMessageSearch(orgId: string, term: string) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: [...chatKeys.all(orgId), "search", trimmed],
    queryFn: () => searchMessages(orgId, trimmed),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
  });
}

export function useSetMuted(orgId: string, conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (muted: boolean) =>
      setConversationMuted(orgId, conversationId, muted),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(orgId),
      }),
  });
}
