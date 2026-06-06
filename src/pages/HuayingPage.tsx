import { Download, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import type { AppActions, ImageDraftTransfer } from "../App";
import { ChatMessage } from "../components/ChatMessage";
import { Composer } from "../components/Composer";
import { AttachmentInput, ChatMessage as ChatMessageType, ChatSession, ImageRecord, PlatformStatus, gardenApi, quotaText } from "../lib/desktopApi";
import { createFallbackSession, createOptimisticSession, mergeSessions, PendingRequest, removePendingPair, retryFilesFromMessage, userMessageForRetry } from "../lib/sessionUi";
import { appendChunkToSession, friendlyUiError, markAssistantFailed } from "../lib/typewriter";

interface SessionMenuState {
  sessionId: string;
}

interface HuayingPageProps {
  actions: AppActions;
  status?: PlatformStatus;
  incomingDraft?: ImageDraftTransfer;
  onDraftConsumed: () => void;
}

function imageQuota(status?: PlatformStatus) {
  if (!status) return undefined;
  if (status.isMember) return status.dailyImageLeft;
  if (status.isLoggedIn) return status.trialImageLeft;
  return status.guestImageLeft;
}

function normalizePrompt(prompt: string) {
  return prompt
    .replace(/如果这个方向对[\s\S]*$/g, "")
    .replace(/如果这份小稿[\s\S]*$/g, "")
    .replace(/点下方的“确认生成图片”[\s\S]*$/g, "")
    .trim();
}

function imageAlt(message: ChatMessageType | ImageRecord) {
  const prompt = "role" in message ? message.imagePrompt : message.prompt;
  return prompt?.slice(0, 36) || "花映图片";
}

function recordFromMessage(message: ChatMessageType): ImageRecord {
  return {
    id: message.id,
    prompt: message.imagePrompt || message.content || "花映图片",
    model: "花映",
    size: "1024x1024",
    imageUrl: message.imageUrl,
    createdAt: message.createdAt
  };
}

export function HuayingPage({ actions, status, incomingDraft, onDraftConsumed }: HuayingPageProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftFiles, setDraftFiles] = useState<AttachmentInput[]>([]);
  const [pending, setPending] = useState<PendingRequest>();
  const [deleteTarget, setDeleteTarget] = useState<ChatSession>();
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>();
  const [preview, setPreview] = useState<ChatMessageType>();
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [imageMessageHeight, setImageMessageHeight] = useState(250);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendTokenRef = useRef(0);
  const previewDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const previewModalRef = useRef<HTMLElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0];
  const quota = imageQuota(status);
  const pageStyle = { "--huaying-image-max-height": `${imageMessageHeight}px` } as CSSProperties;

  useEffect(() => {
    gardenApi.listHuayings().then((items) => {
      setSessions((current) => mergeSessions(current, items));
      setActiveId((current) => current ?? items[0]?.id);
    });
  }, []);

  useEffect(() => {
    return gardenApi.onHuayingChunk((chunk) => {
      setSessions((items) => items.map((session) => appendChunkToSession(session, chunk, chunk.delta)));
    });
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const updateHeight = () => {
      const safeHeight = Math.floor(node.clientHeight - 64);
      setImageMessageHeight(Math.max(210, Math.min(480, safeHeight)));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useEffect(() => {
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
    previewDragRef.current = null;
  }, [preview?.id]);

  useEffect(() => {
    if (!incomingDraft) return;
    setDraft(normalizePrompt(incomingDraft.prompt));
    setDraftFiles(incomingDraft.files);
    onDraftConsumed();
  }, [incomingDraft, onDraftConsumed]);

  const latestContent = active?.messages[active.messages.length - 1]?.content;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active?.id, active?.messages.length, latestContent]);

  async function newHuaying() {
    const session = await gardenApi.createHuaying();
    setSessions((items) => [session, ...items]);
    setActiveId(session.id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await gardenApi.deleteHuaying(deleteTarget.id);
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

  async function send(message = normalizePrompt(draft), files = draftFiles, sessionId = active?.id, retryMessageId?: string) {
    if (!message && files.length === 0) return;
    const baseSession = active ?? createFallbackSession("新的花映");
    const optimistic = createOptimisticSession(baseSession, message, files, {
      fallbackTitle: "新的花映",
      pendingImage: true,
      pendingImageText: "正在生成图片"
    }, retryMessageId);
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
      const savedSession = await gardenApi.sendHuayingMessageStream(request);
      if (sendTokenRef.current !== sendToken) return;
      setSessions((items) => mergeSessions(items, [savedSession]));
      void actions.refreshStatus();
    } catch (error) {
      if (sendTokenRef.current !== sendToken) return;
      const messageText = friendlyUiError(error, "花映生成失败，请稍后再试。");
      actions.showToast(messageText, "bad");
      setSessions((items) => items.map((session) => session.id === optimistic.session.id ? markAssistantFailed(session, optimistic.assistantId, messageText) : session));
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
    void gardenApi.stopHuaying(pending.sessionId);
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

  function closePreview() {
    setPreview(undefined);
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
    previewDragRef.current = null;
  }

  function resetPreviewZoom() {
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
    previewDragRef.current = null;
  }

  function zoomPreview(event: WheelEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPreviewZoom((current) => {
      const next = Math.min(4, Math.max(1, Number((current * (event.deltaY < 0 ? 1.14 : 0.88)).toFixed(2))));
      setPreviewOffset((offset) => clampPreviewOffset(offset, next));
      return next;
    });
  }

  function clampPreviewOffset(offset: { x: number; y: number }, zoom = previewZoom) {
    if (zoom <= 1) return { x: 0, y: 0 };
    const modal = previewModalRef.current;
    const image = previewImageRef.current;
    if (!modal || !image) return offset;
    const modalRect = modal.getBoundingClientRect();
    const scaledWidth = image.offsetWidth * zoom;
    const scaledHeight = image.offsetHeight * zoom;
    const maxX = Math.max(0, (scaledWidth - modalRect.width) / 2);
    const maxY = Math.max(0, (scaledHeight - modalRect.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, offset.x)),
      y: Math.min(maxY, Math.max(-maxY, offset.y))
    };
  }

  function startPreviewDrag(event: PointerEvent<HTMLElement>) {
    if (previewZoom <= 1) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewOffset.x,
      originY: previewOffset.y
    };
  }

  function movePreviewDrag(event: PointerEvent<HTMLElement>) {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewOffset(clampPreviewOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    }));
  }

  function stopPreviewDrag(event: PointerEvent<HTMLElement>) {
    if (previewDragRef.current?.pointerId === event.pointerId) {
      event.stopPropagation();
      previewDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function save(message: ChatMessageType) {
    try {
      const result = await gardenApi.saveImage(recordFromMessage(message));
      if (result.saved) {
        actions.showToast("图片已保存。");
      }
    } catch (error) {
      actions.showToast(friendlyUiError(error, "保存图片失败。"), "bad");
    }
  }

  return (
    <section className="page huaying-page fade-in" style={pageStyle}>
      <header className="page-heading compact-heading">
        <div>
          <span className="eyebrow">花映</span>
          <h2>像聊天一样，一边说一边出图。</h2>
        </div>
        <div className="heading-side">
          <p>每个花映都是一段会话；可以继续说“改成夜晚”“保留上一张风格”，生成成功才消耗 1 次花映。</p>
          {actions.feedbackButton}
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="session-list">
          <div className="session-head">
            <strong>花映</strong>
            <button className="session-add" onClick={newHuaying}><Plus size={17} /></button>
          </div>
          {sessions.length === 0 && <p className="muted">还没有花映会话。</p>}
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
          <div className="chat-title">
            <strong>{active?.title ?? "新的花映"}</strong>
            <span>剩余 {quotaText(quota)} 次 · Enter 生成</span>
          </div>
          <div className="message-scroll" ref={scrollRef}>
            {!active?.messages.length && <div className="empty-state">写下想看的画面，也可以接着上一张继续改。</div>}
            {active?.messages.map((message) => (
              <ChatMessage key={message.id} message={message} onRetry={retry} onPreviewImage={setPreview} />
            ))}
          </div>
          <Composer
            loading={loading}
            value={draft}
            files={draftFiles}
            placeholder="写画面、修改要求，或拖入参考图。"
            sendLabel="开始生成"
            loadingLabel="停止生成"
            hideSendIcon
            onChange={setDraft}
            onFilesChange={setDraftFiles}
            onSend={() => void send()}
            onStop={stop}
          />
        </section>
      </div>

      {preview?.imageUrl && (
        <div className="image-preview-backdrop" onClick={closePreview}>
          <section
            ref={previewModalRef}
            className={`image-preview-modal ${previewZoom > 1 ? "zoomed" : ""}`}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={resetPreviewZoom}
            onPointerDown={startPreviewDrag}
            onPointerMove={movePreviewDrag}
            onPointerUp={stopPreviewDrag}
            onPointerCancel={stopPreviewDrag}
            onWheel={zoomPreview}
          >
            <img
              ref={previewImageRef}
              src={preview.imageUrl}
              alt={imageAlt(preview)}
              draggable={false}
              style={{ transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewZoom})` }}
            />
            <div className="image-preview-hint">滚轮缩放 · 拖拽查看 · 双击复位</div>
            <button className="image-preview-download" onClick={(event) => { event.stopPropagation(); void save(preview); }} aria-label="下载图片"><Download size={24} /></button>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="confirm-backdrop" onClick={() => setDeleteTarget(undefined)}>
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <strong>删除这段花映？</strong>
            <p>删除后，这个花映会话里的文字、参考图和生成图片记录都会移除。</p>
            <div><button onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={confirmDelete}>删除</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
