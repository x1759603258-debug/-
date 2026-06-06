import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Shell, PageKey } from "./components/Shell";
import { AnnouncementInfo, AttachmentInput, gardenApi, PlatformStatus, UpdateInfo } from "./lib/desktopApi";
import { getTimeTheme, TimeTheme } from "./lib/timeTheme";
import { ChatPage } from "./pages/ChatPage";
import { DreamPage } from "./pages/DreamPage";
import { HuayingPage } from "./pages/HuayingPage";
import { SettingsPage } from "./pages/SettingsPage";

export type ThemeMode = "auto" | TimeTheme;
export type ToastKind = "ok" | "bad";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ActiveAnnouncement extends AnnouncementInfo {
  id: string;
  title: string;
  content: string;
  mode: "toast" | "banner" | "modal";
  durationMs: number;
}

export interface AppActions {
  refreshStatus: () => Promise<PlatformStatus | undefined>;
  showToast: (text: string, kind?: ToastKind) => void;
  feedbackButton: ReactNode;
}

export interface ImageDraftTransfer {
  id: number;
  prompt: string;
  files: AttachmentInput[];
}

function splitUpdateNotes(notes?: string) {
  const normalized = (notes || "晚薰新版本已经准备好，可以下载更新。")
    .replace(/；\s*(?=\d+[.、])/g, "\n")
    .replace(/;\s*(?=\d+[.、])/g, "\n");
  return normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export default function App() {
  const [page, setPage] = useState<PageKey>("chat");
  const [autoTheme, setAutoTheme] = useState<TimeTheme>(() => getTimeTheme());
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [status, setStatus] = useState<PlatformStatus>();
  const [toast, setToast] = useState<ToastMessage>();
  const [huayingDraft, setHuayingDraft] = useState<ImageDraftTransfer>();
  const [startupUpdate, setStartupUpdate] = useState<UpdateInfo>();
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement>();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const seenAnnouncementIdsRef = useRef(new Set<string>());
  const startupUpdateNotes = useMemo(() => splitUpdateNotes(startupUpdate?.releaseNotes), [startupUpdate?.releaseNotes]);

  async function refreshStatus() {
    try {
      const next = await gardenApi.getPlatformStatus();
      setStatus(next);
      return next;
    } catch {
      return undefined;
    }
  }

  function showToast(text: string, kind: ToastKind = "ok") {
    const id = Date.now();
    setToast({ id, kind, text });
    window.setTimeout(() => {
      setToast((current) => current?.id === id ? undefined : current);
    }, 2200);
  }

  useEffect(() => {
    void refreshStatus();
  }, [page]);


  useEffect(() => {
    gardenApi.checkForUpdate().then((info) => {
      if (!info.hasUpdate) return;
      const dismissedKey = `wanxun-update-dismissed:${info.latestVersion}`;
      if (!info.forceUpdate && window.localStorage.getItem(dismissedKey) === "1") return;
      setStartupUpdate(info);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let closed = false;
    let hideTimer: number | undefined;

    const pollAnnouncement = async () => {
      try {
        const info = await gardenApi.getAnnouncement();
        if (closed || !info.enabled || !info.id || !info.content?.trim()) return;
        if (seenAnnouncementIdsRef.current.has(info.id)) return;
        const next: ActiveAnnouncement = {
          id: info.id,
          title: info.title || "\u665a\u85b0\u516c\u544a",
          content: info.content,
          mode: info.mode === "banner" || info.mode === "modal" ? info.mode : "toast",
          durationMs: Math.max(2500, Math.min(60_000, Number(info.durationMs ?? 6000))),
          updatedAt: info.updatedAt
        };
        setAnnouncement(next);
        if (next.mode === "toast") {
          window.clearTimeout(hideTimer);
          hideTimer = window.setTimeout(() => {
            seenAnnouncementIdsRef.current.add(next.id);
            setAnnouncement((current) => current?.id === next.id ? undefined : current);
          }, next.durationMs);
        }
      } catch {
        // Announcements must not block the app.
      }
    };

    void pollAnnouncement();
    const timer = window.setInterval(() => void pollAnnouncement(), 8_000);
    return () => {
      closed = true;
      window.clearInterval(timer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  function closeAnnouncement() {
    if (announcement?.id) {
      seenAnnouncementIdsRef.current.add(announcement.id);
    }
    setAnnouncement(undefined);
  }

  function dismissStartupUpdate() {
    if (startupUpdate && !startupUpdate.forceUpdate) {
      window.localStorage.setItem(`wanxun-update-dismissed:${startupUpdate.latestVersion}`, "1");
    }
    setStartupUpdate(undefined);
  }

  async function installStartupUpdate() {
    if (!startupUpdate?.downloadUrl || installingUpdate) return;
    setInstallingUpdate(true);
    try {
      await gardenApi.openUpdateDownload(startupUpdate.downloadUrl, startupUpdate.sha256);
      if (!startupUpdate.forceUpdate) {
        setStartupUpdate(undefined);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更新下载启动失败，请稍后再试。", "bad");
    } finally {
      setInstallingUpdate(false);
    }
  }

  useEffect(() => {
    const refreshTheme = () => setAutoTheme(getTimeTheme());
    refreshTheme();
    const timer = window.setInterval(refreshTheme, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const theme = themeMode === "auto" ? autoTheme : themeMode;
  const randomNightBackground = (current?: number) => {
    const next = Math.floor(Math.random() * 2) + 1;
    return current ? ((current + next - 1) % 3) + 1 : Math.floor(Math.random() * 3) + 1;
  };
  const [nightBackground, setNightBackground] = useState(() => randomNightBackground());
  const [displayTheme, setDisplayTheme] = useState<TimeTheme>(theme);
  const [previousTheme, setPreviousTheme] = useState<TimeTheme>(theme);
  const [themeFading, setThemeFading] = useState(false);
  const themeTimerRef = useRef<number | undefined>(undefined);
  const feedbackButton = (
    <div className={`flower-support ${feedbackOpen ? "open" : ""}`}>
      <button className="flower-support-button" type="button" onClick={() => setFeedbackOpen((open) => !open)} aria-label="打开用户反馈">
        <span className="flower-support-bloom">✿</span>
        <span className="flower-support-label">小花反馈</span>
      </button>
      {feedbackOpen && (
        <section className="flower-support-card">
          <span className="eyebrow">{"小花客服"}</span>
          <h3>{"遇到问题了吗？"}</h3>
          <p>{"把问题写给我们，小花会把纸条送到管理端。"}</p>
          <textarea
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
            placeholder="例如：花映生成太慢 / 激活码不能用 / 想反馈一个小建议..."
            rows={5}
          />
          <div>
            <button
              className="primary-button"
              type="button"
              disabled={feedbackSending}
              onClick={async () => {
                if (!feedbackText.trim()) {
                  showToast("先写一点问题内容呀～", "bad");
                  return;
                }
                try {
                  setFeedbackSending(true);
                  await gardenApi.submitFeedback(feedbackText);
                  setFeedbackText("");
                  setFeedbackOpen(false);
                  showToast("小花收到啦，会尽快送到管理端～");
                } catch (error) {
                  showToast(error instanceof Error ? error.message : "反馈发送失败。", "bad");
                } finally {
                  setFeedbackSending(false);
                }
              }}
            >
              {feedbackSending ? "发送中..." : "发送反馈"}
            </button>
            <button type="button" disabled={feedbackSending} onClick={() => setFeedbackOpen(false)}>{"稍后再说"}</button>
          </div>
        </section>
      )}
    </div>
  );
  const actions: AppActions = { refreshStatus, showToast, feedbackButton };
  const openHuayingWithDraft = (draft: Omit<ImageDraftTransfer, "id">) => {
    setHuayingDraft({ ...draft, id: Date.now() });
    setPage("huaying");
  };
  const clearHuayingDraft = () => setHuayingDraft(undefined);
  const handleThemeModeChange = (mode: ThemeMode) => {
    if (mode === "night") {
      setNightBackground((current) => randomNightBackground(current));
    }
    setThemeMode(mode);
  };

  useEffect(() => {
    if (theme === displayTheme) return;
    if (theme === "night") {
      setNightBackground((current) => randomNightBackground(current));
    }
    window.clearTimeout(themeTimerRef.current);
    setPreviousTheme(displayTheme);
    setDisplayTheme(theme);
    setThemeFading(true);
    themeTimerRef.current = window.setTimeout(() => setThemeFading(false), 900);
    return () => window.clearTimeout(themeTimerRef.current);
  }, [theme, displayTheme]);

  return (
    <Shell
      status={status}
      page={page}
      theme={displayTheme}
      previousTheme={previousTheme}
      themeFading={themeFading}
      themeMode={themeMode}
      nightBackground={nightBackground}
      onThemeModeChange={handleThemeModeChange}
      onPageChange={setPage}
    >
      {toast && <div className={`top-toast ${toast.kind}`}>{toast.text}</div>}
      {announcement?.mode === "toast" && (
        <div className="server-announcement toast">
          <strong>{announcement.title}</strong>
          <span>{announcement.content}</span>
        </div>
      )}
      {announcement?.mode === "banner" && (
        <div className="server-announcement banner">
          <div>
            <strong>{announcement.title}</strong>
            <span>{announcement.content}</span>
          </div>
          <button type="button" onClick={closeAnnouncement}>{"\u6211\u77e5\u9053\u4e86"}</button>
        </div>
      )}
      {announcement?.mode === "modal" && (
        <div className="update-notice-backdrop">
          <section className="update-notice-card server-announcement-modal">
            <span className="eyebrow">{"\u670d\u52a1\u5668\u516c\u544a"}</span>
            <h3>{announcement.title}</h3>
            <div className="update-notice-body">
              {announcement.content.split(/\r?\n/).filter(Boolean).map((line, index) => (
                <p key={`${announcement.id}-${index}`}>{line}</p>
              ))}
            </div>
            <div className="update-notice-actions">
              <button className="primary-button" type="button" onClick={closeAnnouncement}>{"\u6211\u77e5\u9053\u4e86"}</button>
            </div>
          </section>
        </div>
      )}
      {startupUpdate && (
        <div className="update-notice-backdrop">
          <section className="update-notice-card startup-update-modal">
            <span className="eyebrow">{"\u8f6f\u4ef6\u66f4\u65b0"}</span>
            <h3>{startupUpdate.releaseTitle || "\u665a\u85b0\u66f4\u65b0\u516c\u544a"}</h3>
            <p className="update-version-line">{"\u5f53\u524d"} {startupUpdate.currentVersion} | {"\u6700\u65b0"} {startupUpdate.latestVersion}</p>
            <div className="update-notice-body">
              {startupUpdateNotes.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
            </div>
            <div className="update-notice-actions">
              {!startupUpdate.forceUpdate && <button type="button" onClick={dismissStartupUpdate} disabled={installingUpdate}>{"\u7a0d\u540e\u66f4\u65b0"}</button>}
              <button className="primary-button" type="button" onClick={() => void installStartupUpdate()} disabled={installingUpdate}>
                {installingUpdate ? "准备下载" : "\u7acb\u5373\u66f4\u65b0"}
              </button>
            </div>
          </section>
        </div>
      )}
      {page === "chat" && <ChatPage actions={actions} status={status} />}
      {page === "dream" && <DreamPage actions={actions} onOpenHuaying={openHuayingWithDraft} />}
      {page === "huaying" && (
        <HuayingPage
          actions={actions}
          status={status}
          incomingDraft={huayingDraft}
          onDraftConsumed={clearHuayingDraft}
        />
      )}
      {page === "settings" && <SettingsPage actions={actions} status={status} />}
    </Shell>
  );
}
