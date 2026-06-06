import { KeyboardEvent, useEffect, useState } from "react";
import type { AppActions } from "../App";
import { validateAccount } from "../lib/accountValidation.js";
import { AppSettings, fixedPlatformSettings, gardenApi, PlatformStatus, quotaText, UpdateInfo } from "../lib/desktopApi";

const initial: AppSettings = {
  platformBaseUrl: fixedPlatformSettings.platformBaseUrl,
  deviceId: "",
  chatModel: fixedPlatformSettings.chatModel,
  imageModel: fixedPlatformSettings.imageModel,
  stream: true
};

const officialGroupUrl = "https://qm.qq.com/q/w6tCaQDEj";

const fallbackCheckinPlan: NonNullable<PlatformStatus["checkinPlan"]> = [
  { day: 1, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 2, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 3, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 4, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 5, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 6, chat: 10, image: 0, randomChat: true, chatMin: 1, chatMax: 10 },
  { day: 7, chat: 30, image: 1, randomChat: false, chatMin: 30, chatMax: 30 }
];

function memberName(status?: PlatformStatus) {
  if (!status?.isMember) return "免费用户";
  if (status.memberPlan === "fvip") return "FVIP";
  if (status.memberPlan === "one_day") return "1 Day";
  if (status.memberPlan === "three_day") return "三天试用会员";
  return "七天会员";
}

function statusText(status?: PlatformStatus) {
  if (!status) return "正在读取花园状态";
  if (status.isMember) {
    if (status.memberPlan === "fvip") return "会员｜轻语无限｜花映无限";
    const label = status.memberQuotaMode === "period" ? "会员额度" : "今日额度";
    return `${memberName(status)}｜${label} 轻语 ${quotaText(status.dailyChatLeft)}｜花映 ${quotaText(status.dailyImageLeft)}`;
  }
  if (status.isLoggedIn) return `${status.username}｜免费轻语 ${quotaText(status.trialChatLeft)}｜花映 ${quotaText(status.trialImageLeft)}`;
  return `游客体验｜轻语 ${quotaText(status.guestChatLeft)}｜花映 ${quotaText(status.guestImageLeft)}`;
}

function checkinRewardText(status?: PlatformStatus) {
  const reward = status?.lastCheckinReward;
  const chat = reward?.chat ?? status?.checkinTodayChatReward ?? 0;
  const image = reward?.image ?? status?.checkinTodayImageReward ?? 0;
  return image > 0 ? `+${chat} 轻语，+${image} 花映` : `+${chat} 轻语`;
}

function checkinPlanText(day: NonNullable<PlatformStatus["checkinPlan"]>[number]) {
  if (day.randomChat) return "随机轻语";
  return day.image > 0 ? `+${day.chat} 轻语｜+${day.image} 花映` : `+${day.chat} 轻语`;
}

const checkinFlowers = [
  {
    name: "daisy",
    label: "雏菊",
    bud: new URL("../assets/checkin-flowers/daisy-bud.png", import.meta.url).href,
    bloom: new URL("../assets/checkin-flowers/daisy-bloom.png", import.meta.url).href
  },
  {
    name: "tulip",
    label: "郁金香",
    bud: new URL("../assets/checkin-flowers/tulip-bud.png", import.meta.url).href,
    bloom: new URL("../assets/checkin-flowers/tulip-bloom.png", import.meta.url).href
  },
  {
    name: "camellia",
    label: "山茶",
    bud: new URL("../assets/checkin-flowers/camellia-bud.png", import.meta.url).href,
    bloom: new URL("../assets/checkin-flowers/camellia-bloom.png", import.meta.url).href
  },
  {
    name: "rose",
    label: "玫瑰",
    bud: new URL("../assets/checkin-flowers/rose-bud.png", import.meta.url).href,
    bloom: new URL("../assets/checkin-flowers/rose-bloom.png", import.meta.url).href
  },
  {
    name: "waterlily",
    label: "睡莲",
    bud: new URL("../assets/checkin-flowers/waterlily-bud.png", import.meta.url).href,
    bloom: new URL("../assets/checkin-flowers/waterlily-bloom.png", import.meta.url).href
  },
  {
    name: "hydrangea",
    label: "绣球",
    bud: new URL("../assets/checkin-flowers/hydrangea-bud.png", import.meta.url).href,
    bloom: new URL("../assets/checkin-flowers/hydrangea-bloom.png", import.meta.url).href
  },
  {
    name: "lavender",
    label: "薰衣草",
    bud: new URL("../assets/checkin-flowers/lavender-bud.png", import.meta.url).href,
    bloom: new URL("../assets/checkin-flowers/lavender-bloom.png", import.meta.url).href
  }
] as const;

function CheckinPlant({ bloom, day }: { bloom: boolean; day: number }) {
  const flower = checkinFlowers[(day - 1) % checkinFlowers.length];

  return (
    <img
      className="checkin-sprite"
      src={bloom ? flower.bloom : flower.bud}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

function friendlyUiError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  if (/Failed to fetch|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|NetworkError/i.test(cleaned)) {
    return "小花园暂时没连上，请稍后再试。";
  }
  if (/Bad Request|FST_ERR_CTP_EMPTY_JSON_BODY|Body cannot be empty/i.test(cleaned)) {
    return fallback;
  }
  if (/没有这个账号/.test(cleaned)) return "没有找到这个账号。请先注册，或检查用户名有没有输错。";
  if (/密码不正确/.test(cleaned)) return "密码不正确，请重新输入。";
  if (/已经注册过账号/.test(cleaned)) return "这台设备已经注册过账号，请直接登录。";
  if (/用户名已经被注册/.test(cleaned)) return "这个用户名已经被注册，请换一个。";
  if (/这台设备注册的账号是/.test(cleaned)) return cleaned.replace(/\s+/g, "").replace("请用这个账号登录。", "，请用这个账号登录。");
  if (/用户名需|密码需|今天已经签到过啦|登录后才能签到|花钥匙|三天试用会员/.test(cleaned)) return cleaned;

  return cleaned || fallback;
}

export function SettingsPage({ actions, status }: { actions: AppActions; status?: PlatformStatus }) {
  const [settings, setSettings] = useState<AppSettings>(initial);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [licenseCode, setLicenseCode] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    gardenApi.getSettings().then((next) => {
      setSettings(next);
      setUsername(next.username ?? "");
      gardenApi.getPlatformStatus().then(() => actions.refreshStatus()).catch(() => undefined);
    });
  }, []);

  async function auth() {
    if (authMode === "register") {
      const validation = validateAccount(username, password);
      if (validation) {
        actions.showToast(validation, "bad");
        return;
      }
    }

    try {
      authMode === "login" ? await gardenApi.loginAccount(username, password) : await gardenApi.registerAccount(username, password);
      await actions.refreshStatus();
      setSettings(await gardenApi.getSettings());
      setPassword("");
      actions.showToast(authMode === "login" ? "登录成功。" : "注册成功，已获得免费额度。");
    } catch (error) {
      actions.showToast(friendlyUiError(error, "账号请求失败，请稍后再试。"), "bad");
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && username.trim() && password.trim()) {
      event.preventDefault();
      void auth();
    }
  }

  async function logout() {
    await gardenApi.logoutAccount();
    await actions.refreshStatus();
    setSettings(await gardenApi.getSettings());
    setUsername("");
    setPassword("");
    actions.showToast("已退出登录，当前为游客体验。");
  }

  async function activate() {
    try {
      await gardenApi.activateLicense(licenseCode);
      await actions.refreshStatus();
      actions.showToast("花钥匙已生效，会员已经开放。");
      setLicenseCode("");
    } catch (error) {
      actions.showToast(friendlyUiError(error, "花钥匙暂时没有打开花园。"), "bad");
    }
  }

  async function checkin() {
    try {
      const next = await gardenApi.checkin();
      await actions.refreshStatus();
      actions.showToast(`签到成功，${checkinRewardText(next)}。`);
    } catch (error) {
      actions.showToast(friendlyUiError(error, "签到失败，请稍后再试。"), "bad");
    }
  }

  function openOfficialGroup() {
    void gardenApi.openExternal(officialGroupUrl);
  }

  async function checkUpdate() {
    try {
      setCheckingUpdate(true);
      const next = await gardenApi.checkForUpdate();
      setUpdateInfo(next);
      actions.showToast(next.hasUpdate ? "发现新版本，可以下载更新。" : "当前已经是最新版本。");
    } catch (error) {
      actions.showToast(error instanceof Error ? error.message : "检查更新失败。", "bad");
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function downloadUpdate() {
    if (!updateInfo?.downloadUrl) return;
    await gardenApi.openUpdateDownload(updateInfo.downloadUrl, updateInfo.sha256);
  }

  return (
    <section className="page settings-page fade-in">
      <header className="page-heading compact-heading">
        <div>
          <span className="eyebrow">小屋设置</span>
          <h2>账号、花钥匙和服务连接。</h2>
        </div>
        <p>{statusText(status)}</p>
      </header>

      <div id="settings-form" className="settings-form">
        <section className="settings-card">
          <div className="panel-title vertical-title">
            <div>
              <strong>账号</strong>
              <span>注册后每天可用 30 次轻语、1 次花映</span>
            </div>
          </div>
          <div className="account-status">{statusText(status)}</div>
          {!status?.isLoggedIn ? (
            <div className="auth-box">
              <div className="mode-switch">
                <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>登录</button>
                <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>注册</button>
              </div>
              <input value={username} onChange={(event) => setUsername(event.target.value)} onKeyDown={submitOnEnter} placeholder="用户名" />
              <input value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={submitOnEnter} placeholder="密码" type="password" />
              <button className="primary-button" type="button" onClick={auth} disabled={!username.trim() || !password.trim()}>{authMode === "login" ? "登录" : "注册并领取额度"}</button>
            </div>
          ) : (
            <div className="account-details">
              <span><b>当前账号</b>{status.username}</span>
              <span><b>当前身份</b>{memberName(status)}</span>
              <span><b>设备绑定</b>已绑定当前小屋</span>
              <button className="soft-button" type="button" onClick={logout}>退出登录</button>
            </div>
          )}
        </section>

        <section className="settings-card">
          <div className="panel-title vertical-title">
            <div>
              <strong>花钥匙</strong>
              <span>激活三天试用会员、七天会员或 FVIP</span>
            </div>
          </div>
          <div className="activation-row">
            <input value={licenseCode} onChange={(event) => setLicenseCode(event.target.value)} placeholder="输入花钥匙 / 会员激活码" />
            <button className="soft-button" type="button" onClick={activate} disabled={!licenseCode.trim() || !status?.isLoggedIn}>打开花园</button>
          </div>
          <div className={`checkin-panel checkin-card ${!status?.isLoggedIn ? "locked" : ""}`}>
            <div className="checkin-head">
              <div>
                <b>每日签到</b>
                <span>{status?.isLoggedIn ? "每日签到随机获得轻语，第七天必得大花礼。" : "登录后可签到领取奖励；游客模式不能签到。"}</span>
              </div>
              <em>奖励余额：{status?.bonusChatLeft ?? status?.checkinChatBonus ?? 0} 轻语｜{status?.bonusImageLeft ?? status?.checkinImageBonus ?? 0} 花映</em>
            </div>
            <div className="checkin-garden" aria-label="七天签到花园">
              {(status?.checkinPlan ?? fallbackCheckinPlan).map((day) => {
                const currentDay = status?.isLoggedIn ? (status.canCheckin ? status.nextCheckinDay ?? 1 : status.checkinCycleDay ?? 1) : 0;
                const isCurrent = Boolean(status?.isLoggedIn && day.day === currentDay);
                const isBloom = Boolean(status?.isLoggedIn && (day.day < currentDay || (!status.canCheckin && day.day === currentDay)));
                const canClick = Boolean(status?.isLoggedIn && status.canCheckin && isCurrent);
                return (
                  <button
                    key={day.day}
                    className={`checkin-flower flower-${day.day} ${checkinFlowers[(day.day - 1) % checkinFlowers.length].name} ${isBloom ? "bloom" : "bud"} ${isCurrent ? "current" : ""}`}
                    type="button"
                    onClick={canClick ? checkin : undefined}
                    disabled={!canClick}
                    title={checkinPlanText(day)}
                    aria-label={canClick ? `签到第 ${day.day} 天` : `第 ${day.day} 天${isBloom ? "已开花" : "花苞"}`}
                  >
                    <CheckinPlant bloom={isBloom} day={day.day} />
                    <span className="flower-particles" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="checkin-footer">
              <div className="checkin-current">{status?.isLoggedIn ? (status.canCheckin ? `点亮第 ${status.nextCheckinDay ?? 1} 天的小花` : `第 ${status.checkinCycleDay ?? 1} 天已开花`) : "登录后开启签到花园"}</div>
              <button className="official-group-link" type="button" onClick={openOfficialGroup}>
                点击加入【晚薰-官方群】
              </button>
            </div>
          </div>
        </section>

        <section className="settings-card platform-card">
          <div className="panel-title vertical-title">
            <div>
              <strong>平台服务</strong>
              <span>服务统一托管，能力自动保持最新</span>
            </div>
          </div>
          <div className="quota-grid platform-grid">
            <span><b>设备 ID</b>{settings.deviceId || "自动生成"}</span>
            <span><b>当前身份</b>{status?.displayName ?? status?.mode ?? "guest"}</span>
            <span><b>轻语剩余</b>{quotaText(status?.isMember ? status.dailyChatLeft : status?.isLoggedIn ? status.trialChatLeft : status?.guestChatLeft)}</span>
            <span><b>花映剩余</b>{quotaText(status?.isMember ? status.dailyImageLeft : status?.isLoggedIn ? status.trialImageLeft : status?.guestImageLeft)}</span>
            <span><b>轻语能力</b>高质量聊天与文件理解</span>
            <span><b>绘梦能力</b>构思引导、参考图理解与小稿整理</span>
          </div>
        </section>

        <section className="settings-card update-card">
          <div className="panel-title vertical-title">
            <div>
              <strong>软件更新</strong>
              <span>检查新版本，支持软件内下载进度。</span>
            </div>
          </div>
          <div className="update-status-box">
            <span>{updateInfo ? `${updateInfo.releaseTitle ? `${updateInfo.releaseTitle}\n` : ""}${updateInfo.releaseNotes ?? ""}` : "点击检查更新，发现新版本后可在软件内下载。"}</span>
            {updateInfo?.hasUpdate && <em>当前 {updateInfo.currentVersion} | 最新 {updateInfo.latestVersion}</em>}
          </div>
          <div className="settings-actions">
            <button className="soft-button" type="button" onClick={checkUpdate} disabled={checkingUpdate}>{checkingUpdate ? "检查中" : "检查更新"}</button>
            {updateInfo?.hasUpdate && updateInfo.downloadUrl ? (
              <button className="primary-button" type="button" onClick={downloadUpdate}>下载更新</button>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
