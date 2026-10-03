import { useCallback, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { useOrg } from "@/hooks/useOrg";
import { cn } from "@/lib/cn";
import { useMembers } from "@/features/members/queries";
import { ConversationList } from "./ConversationList";
import { GroupInfoModal } from "./GroupInfoModal";
import { NewChatModal } from "./NewChatModal";
import { ThreadView } from "./ThreadView";
import { useChatConfig, useConversations, usePresence } from "./queries";

export function MessagesPage() {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?m=<message id> comes from a search result: scroll to that message.
  const jumpToMessageId = searchParams.get("m");
  const clearJump = useCallback(
    () =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("m");
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const myId = user!.id;

  const conversations = useConversations(orgId);
  const members = useMembers(orgId);
  const presence = usePresence(orgId);
  const config = useChatConfig(orgId);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const list = conversations.data?.conversations;
  const active = conversationId
    ? list?.find((conversation) => conversation.id === conversationId)
    : undefined;

  const open = (id: string) => void navigate(`/orgs/${orgId}/messages/${id}`);
  const openMessage = (id: string, messageId: string) =>
    void navigate(`/orgs/${orgId}/messages/${id}?m=${messageId}`);
  const backToList = () => void navigate(`/orgs/${orgId}/messages`);

  // A link to a chat you can't see (or have left) reads the same as one that
  // never existed.
  const missing = Boolean(conversationId) && list !== undefined && !active;

  return (
    <div className="flex h-[calc(100dvh-4rem)] bg-white dark:bg-slate-900">
      <aside
        className={cn(
          "w-full shrink-0 border-r border-slate-200 md:block md:w-80 lg:w-96 dark:border-slate-800",
          conversationId ? "hidden" : "block",
        )}
      >
        <ConversationList
          orgId={orgId}
          conversations={list}
          isPending={conversations.isPending}
          isError={conversations.isError}
          myId={myId}
          activeId={conversationId ?? null}
          online={presence.data}
          onSelect={open}
          onOpenMessage={openMessage}
          onNew={() => setNewChatOpen(true)}
        />
      </aside>

      <section
        className={cn(
          "min-w-0 flex-1",
          conversationId ? "block" : "hidden md:block",
        )}
        aria-label="Conversation"
      >
        {active ? (
          <ThreadView
            key={active.id}
            orgId={orgId}
            conversation={active}
            myId={myId}
            orgMembers={members.data}
            online={presence.data}
            attachmentsEnabled={config.data?.attachments ?? false}
            jumpToMessageId={jumpToMessageId}
            onJumped={clearJump}
            onBack={backToList}
            onOpenInfo={() => setInfoOpen(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-slate-50 px-6 text-center dark:bg-slate-950">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-14 w-14 text-slate-300 dark:text-slate-600"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
            </svg>
            <p className="mt-4 text-base font-semibold text-slate-800 dark:text-slate-100">
              {missing
                ? "That conversation isn't available"
                : conversationId
                  ? "Opening conversation…"
                  : "Pick a conversation"}
            </p>
            <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
              {missing
                ? "It may have been removed, or you're no longer part of it."
                : "Choose someone from the list, or start a new chat or group."}
            </p>
          </div>
        )}
      </section>

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        orgId={orgId}
        myId={myId}
        members={members.data}
        membersPending={members.isPending}
        online={presence.data}
        onOpened={open}
      />

      {active?.type === "group" && (
        <GroupInfoModal
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          orgId={orgId}
          myId={myId}
          conversation={active}
          orgMembers={members.data}
          membersPending={members.isPending}
          online={presence.data}
          onLeft={backToList}
        />
      )}
    </div>
  );
}
