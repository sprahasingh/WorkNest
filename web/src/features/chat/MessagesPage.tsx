import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { useOrg } from "@/hooks/useOrg";
import { cn } from "@/lib/cn";
import { useMembers } from "@/features/members/queries";
import { toast } from "sonner";
import { parseApiError } from "@/lib/apiError";
import type { Conversation } from "./api";
import { conversationTitle } from "./chatUtils";
import { ConversationList } from "./ConversationList";
import {
  DeleteConversationModal,
  type DeleteChoice,
} from "./DeleteConversationModal";
import { GroupInfoModal } from "./GroupInfoModal";
import { NewChatModal } from "./NewChatModal";
import { ThreadView } from "./ThreadView";
import {
  useChatConfig,
  useConversationActions,
  useConversations,
  useLeaveConversation,
  usePresence,
} from "./queries";

// The height you can actually see. On phones the browser's address bar and the
// on-screen keyboard change it, and plain 100vh doesn't follow, which is what
// left a blank strip under the chat and a screen that wouldn't stay put.
function useVisibleHeight(): number {
  const read = () => window.visualViewport?.height ?? window.innerHeight;
  const [height, setHeight] = useState(read);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      setHeight(read());
      // iOS scrolls the page when the keyboard opens; keep it put. Only on
      // touch devices: on a computer a resized window must not jump the page.
      if (window.matchMedia("(pointer: coarse)").matches) window.scrollTo(0, 0);
    };
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
    };
  }, []);
  return height;
}

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
  const visibleHeight = useVisibleHeight();

  // This page fills the screen and scrolls inside itself, so the page behind
  // it is locked while it's open.
  useEffect(() => {
    document.documentElement.classList.add("lock-scroll");
    return () => document.documentElement.classList.remove("lock-scroll");
  }, []);

  const conversations = useConversations(orgId);
  const members = useMembers(orgId);
  const presence = usePresence(orgId);
  const config = useChatConfig(orgId);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const conversationActions = useConversationActions(orgId);
  const leave = useLeaveConversation(orgId);

  const list = conversations.data?.conversations;
  const active = conversationId
    ? list?.find((conversation) => conversation.id === conversationId)
    : undefined;

  const open = (id: string) => void navigate(`/orgs/${orgId}/messages/${id}`);
  const openMessage = (id: string, messageId: string) =>
    void navigate(`/orgs/${orgId}/messages/${id}?m=${messageId}`);
  const backToList = () => void navigate(`/orgs/${orgId}/messages`);

  const confirmDelete = (choice: DeleteChoice) => {
    const target = deleteTarget;
    if (!target) return;
    const done = () => {
      setDeleteTarget(null);
      if (conversationId === target.id) backToList();
      toast.success(
        choice === "leave" ? "You left the group" : "Conversation deleted",
      );
    };
    const fail = (error: unknown) => toast.error(parseApiError(error).message);
    if (choice === "leave") {
      leave.mutate(
        { id: target.id, userId: myId },
        { onSuccess: done, onError: fail },
      );
    } else {
      conversationActions.clear.mutate(target.id, {
        onSuccess: done,
        onError: fail,
      });
    }
  };

  // "Group details" from the list opens that chat, then its details.
  const openDetails = (id: string) => {
    open(id);
    setInfoOpen(true);
  };

  // A link to a chat you can't see (or have left) reads the same as one that
  // never existed.
  const missing = Boolean(conversationId) && list !== undefined && !active;

  return (
    <div
      className="flex bg-white dark:bg-slate-900"
      style={{ height: `${Math.max(visibleHeight - 64, 0)}px`, minHeight: 0 }}
    >
      <aside
        data-tour="messages-content"
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
          onOpenDetails={openDetails}
          onRequestDelete={setDeleteTarget}
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
            onRequestDelete={setDeleteTarget}
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

      <DeleteConversationModal
        conversation={deleteTarget}
        title={deleteTarget ? conversationTitle(deleteTarget, myId) : ""}
        pending={leave.isPending || conversationActions.clear.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

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
