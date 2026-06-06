import { Image, MessageCircle, Palette, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { ThemeMode } from "../App";
import logoUrl from "../assets/brand/logo.png";
import type { PlatformStatus } from "../lib/desktopApi";
import { quotaText } from "../lib/desktopApi";
import { themeLabel, TimeTheme } from "../lib/timeTheme";

export type PageKey = "chat" | "dream" | "huaying" | "settings";

interface ShellProps {
  status?: PlatformStatus;
  page: PageKey;
  theme: TimeTheme;
  previousTheme?: TimeTheme;
  themeFading?: boolean;
  themeMode: ThemeMode;
  nightBackground: number;
  onThemeModeChange: (mode: ThemeMode) => void;
  onPageChange: (page: PageKey) => void;
  children: ReactNode;
  floatingSlot?: ReactNode;
}

const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: "自动", value: "auto" },
  { label: "白天", value: "day" },
  { label: "黄昏", value: "dusk" },
  { label: "夜晚", value: "night" }
];

function memberQuotaText(status: PlatformStatus) {
  if (status.memberPlan === "fvip") return "会员 无限";
  const label = status.memberQuotaMode === "period" ? "会员额度" : "会员今日";
  return `${label} ${quotaText(status.dailyChatLeft)}｜${quotaText(status.dailyImageLeft)}`;
}

function sidebarQuotaText(status?: PlatformStatus) {
  if (!status) return "额度读取中";
  if (status.isMember) return memberQuotaText(status);
  if (status.isLoggedIn) return `免费 ${quotaText(status.trialChatLeft)}｜${quotaText(status.trialImageLeft)}`;
  return `游客 ${quotaText(status.guestChatLeft)}｜${quotaText(status.guestImageLeft)}`;
}

export function Shell({ status, page, theme, previousTheme = theme, themeFading = false, themeMode, nightBackground, onThemeModeChange, onPageChange, children, floatingSlot }: ShellProps) {

  return (
    <div className={`app-shell theme-${theme} ${themeFading ? "theme-fading" : ""}`} style={{ "--previous-bg": `var(--bg-${previousTheme})`, "--current-bg": `var(--bg-${theme})`, "--bg-night-active": `var(--bg-night-${nightBackground})` } as React.CSSProperties}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-logo"><img src={logoUrl} alt="晚薰" /></div>
          <strong>晚薰</strong>
          <span>轻语、绘梦与花映</span>
        </div>

        <nav className="nav-list" aria-label="主功能">
          <button className={`nav-item ${page === "chat" ? "active" : ""}`} onClick={() => onPageChange("chat")}>
            <MessageCircle size={20} />
            <b>轻语</b>
            <small>聊天</small>
          </button>
          <button className={`nav-item ${page === "dream" ? "active" : ""}`} onClick={() => onPageChange("dream")}>
            <Image size={20} />
            <b>绘梦</b>
            <small>构思</small>
          </button>
          <button className={`nav-item ${page === "huaying" ? "active" : ""}`} onClick={() => onPageChange("huaying")}>
            <Palette size={20} />
            <b>花映</b>
            <small>出图</small>
          </button>
        </nav>

        <div className="theme-note">
          <strong>{themeLabel(theme)}</strong>
          <span>{sidebarQuotaText(status)}</span>
          <button className={`account-entry ${page === "settings" ? "active" : ""}`} type="button" onClick={() => onPageChange("settings")}>
            <Settings size={13} />
            {status?.isLoggedIn ? status.username ?? "账号" : "登录/注册"}
          </button>
          <div className="theme-test-switch">
            {themeOptions.map((option) => (
              <button key={option.value} className={themeMode === option.value ? "active" : ""} onClick={() => onThemeModeChange(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <main className="main-stage">{children}</main>
      {floatingSlot}
    </div>
  );
}
