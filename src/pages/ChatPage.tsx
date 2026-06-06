import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppActions } from "../App";
import { ChatMessage } from "../components/ChatMessage";
import { Composer } from "../components/Composer";
import { AttachmentInput, ChatMessage as ChatMessageType, ChatSession, gardenApi } from "../lib/desktopApi";
import { createFallbackSession, createOptimisticSession, mergeSessions, PendingRequest, removePendingPair, retryFilesFromMessage, userMessageForRetry } from "../lib/sessionUi";
import { appendChunkToSession, friendlyUiError, markAssistantFailed } from "../lib/typewriter";

interface SessionMenuState {
  sessionId: string;
}

export function ChatPage({ actions }: { actions: AppActions; status?: import("../lib/desktopApi").PlatformStatus }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftFiles, setDraftFiles] = useState<AttachmentInput[]>([]);
  const [pending, setPending] = useState<PendingRequest>();
  const [deleteTarget, setDeleteTarget] = useState<ChatSession>();
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendTokenRef = useRef(0);
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0];

  useEffect(() => {
    gardenApi.listChats().then((items) => {
      setSessions((current) => mergeSessions(current, items));
      setActiveId((current) => current ?? items[0]?.id);
    });
  }, []);

  useEffect(() => {
    return gardenApi.onChatChunk((chunk) => {
      setSessions((items) => items.map((session) => appendChunkToSession(session, chunk, chunk.delta)));
    });
  }, []);

  const latestContent = active?.messages[active.messages.length - 1]?.content;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active?.id, active?.messages.length, latestContent]);

  async function newChat() {
    const session = await gardenApi.createChat();
    setSessions((items) => [session, ...items]);
    setActiveId(session.id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await gardenApi.deleteChat(deleteTarget.id);
    const next = sessions.filter((session) => session.id !== deleteTarget.id);
    setSessions(next);
    setActiveId(next[0]?.id);
    setDeleteTarget(undefined);
  }

  function openSessionMenu(event: React.MouseEvent, session: ChatSession) {
    event.preventDefault();
    setSessionMenu({ sessionId: session.id });
  }

  function requestDeleteSession(session: ChatSession) {
    setDeleteTarget(session);
    setSessionMenu(undefined);
  }

  async function send(message = draft.trim(), files = draftFiles, sessionId = active?.id, retryMessageId?: string) {
    if (!message && files.length === 0) return;
    const baseSession = active ?? createFallbackSession("新的轻语");
    const optimistic = createOptimisticSession(baseSession, message, files, { fallbackTitle: "新的轻语" }, retryMessageId);
    const request = { sessionId: sessionId ?? optimistic.session.id, message, files, optimisticAssistantId: optimistic.assistantId };
    sendTokenRef.current += 1;
    const sendToken = sendTokenRef.current;
    setSessions((items) => [optimistic.session, ...items.filter((item) => item.id !== optimistic.session.id)]);
    setActiveId(optimistic.session.id);
    setPending(request);
    setDraft("");
    setDraftFiles([]);
    setLoading(true);
    try {
      const savedSession = await gardenApi.sendChatMessageStream(request);
      if (sendTokenRef.current !== sendToken) return;
      setSessions((items) => mergeSessions(items, [savedSession]));
      void actions.refreshStatus();
    } catch (error) {
      if (sendTokenRef.current !== sendToken) return;
      const messageText = friendlyUiError(error);
      actions.showToast(messageText, "bad");
      setSessions((items) => items.map((session) => session.id === optimistic.session.id ? markAssistantFailed(session, optimistic.assistantId, messageText) : session));
      setDraft(message);
      setDraftFiles(files);
    } finally {
      if (sendTokenRef.current === sendToken) {
        setLoading(false);
        setPending(undefined);
      }
    }
  }

  function stop() {
    if (!pending) return;
    sendTokenRef.current += 1;
    void gardenApi.stopChat(pending.sessionId);
    setSessions((items) => items.map((session) => session.id === pending.sessionId ? removePendingPair(session, pending) : session));
    setDraft(pending.message);
    setDraftFiles(pending.files);
    setLoading(false);
    setPending(undefined);
  }

  function retry(message: ChatMessageType) {
    const user = userMessageForRetry(active, message);
    if (!user) return;
    void send(user.content, retryFilesFromMessage(user), active?.id, message.id);
  }

  return (
    <section className="page chat-page fade-in">
      <header className="page-heading compact-heading">
        <div>
          <span className="eyebrow">轻语</span>
          <h2>今天想聊些什么？</h2>
        </div>
        <div className="heading-side">
          <p>高质量轻语聊天；支持拖入图片和文件让 AI 分析，图片 10MB 内、文件 7MB 内。</p>
          {actions.feedbackButton}
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="session-list">
          <div className="session-head">
            <strong>会话</strong>
            <button className="session-add" onClick={newChat}><Plus size={17} /></button>
          </div>
          {sessions.length === 0 && <p className="muted">还没有会话。</p>}
          {sessions.map((session) => (
            <div key={session.id} className="session-item-wrap">
              <button className={`session-item ${active?.id === session.id ? "active" : ""}`} onClick={() => setActiveId(session.id)} onContextMenu={(event) => openSessionMenu(event, session)}>
                <b>{session.title}</b>
                <span>{session.messages[session.messages.length - 1]?.content || new Date(session.updatedAt).toLocaleDateString()}</span>
              </button>
              {sessionMenu?.sessionId === session.id && <button className="session-delete-popover" onClick={() => requestDeleteSession(session)}>删除</button>}
            </div>
          ))}
        </aside>

        <section className="chat-card">
          <div className="chat-title"><strong>{active?.title ?? "新的轻语"}</strong><span>逐字回复 · Enter 发送</span></div>
          <div className="message-scroll" ref={scrollRef}>
            {!active?.messages.length && <div className="empty-state">先写一句就好。</div>}
            {active?.messages.map((message) => <ChatMessage key={message.id} message={message} onRetry={retry} />)}
          </div>
          <Composer loading={loading} value={draft} files={draftFiles} onChange={setDraft} onFilesChange={setDraftFiles} onSend={() => void send()} onStop={stop} />
        </section>
      </div>

      {deleteTarget && (
        <div className="confirm-backdrop" onClick={() => setDeleteTarget(undefined)}>
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <strong>删除这段轻语？</strong>
            <p>删除后，这个会话文件夹里的消息、图片和文件都会移除。</p>
            <div><button onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={confirmDelete}>删除</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
