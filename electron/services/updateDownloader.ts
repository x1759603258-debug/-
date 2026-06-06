import { app, BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

let updateProgressWindow: BrowserWindow | undefined;

function safeUnlink(filePath: string) {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // best effort cleanup
  }
}

function updateProgressHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>\u665a\u85b0\u66f4\u65b0</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#fff8ef,#fff0f5);font-family:"Microsoft YaHei",system-ui,sans-serif;color:#342833;overflow:hidden}
.card{width:calc(100vw - 28px);min-height:78px;display:grid;grid-template-columns:minmax(0,1fr) 250px auto;align-items:center;gap:18px;padding:16px 18px 16px 22px;border-radius:24px;background:linear-gradient(135deg,#fffaf4 0%,#fff0f5 52%,#f3fff7 100%);box-shadow:0 18px 50px rgba(77,42,61,.20),inset 0 1px 0 rgba(255,255,255,.86);border:1px solid rgba(214,126,151,.24);position:relative;overflow:hidden}
.card:before{content:"";position:absolute;inset:-76px auto auto -44px;width:160px;height:160px;border-radius:999px;background:radial-gradient(circle,rgba(244,151,171,.30),transparent 68%);pointer-events:none}
.copy{position:relative;z-index:1;min-width:0;display:grid;gap:5px}.head{display:flex;align-items:baseline;gap:10px;min-width:0}.eyebrow{flex:0 0 auto;color:#d26a88;font-size:12px;font-weight:900;letter-spacing:.16em}h1{min-width:0;margin:0;font-size:18px;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.detail{margin:0;color:#7f6675;font-size:13px;line-height:1.45;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{height:12px;border-radius:999px;background:#f6dfe6;overflow:hidden;box-shadow:inset 0 1px 3px rgba(120,75,92,.13)}
.fill{width:0%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#f08aa6,#ffc8d5 48%,#8ea7ff);box-shadow:0 0 16px rgba(240,138,166,.38);transition:width .28s ease}
.meta{position:relative;z-index:1;display:flex;align-items:center;justify-content:flex-end;gap:12px;color:#9d7e8b;font-size:12px;font-weight:900;white-space:nowrap}.pulse{width:9px;height:9px;border-radius:999px;background:#f08aa6;box-shadow:0 0 0 0 rgba(240,138,166,.55);animation:pulse 1.2s infinite}.row{display:flex;align-items:center;gap:8px}@keyframes pulse{to{box-shadow:0 0 0 12px rgba(240,138,166,0)}}
</style></head><body><section class="card"><div class="copy"><div class="head"><span class="eyebrow">\u8f6f\u4ef6\u66f4\u65b0</span><h1 id="title">\u6b63\u5728\u51c6\u5907\u66f4\u65b0</h1></div><p class="detail" id="detail">\u665a\u85b0\u6b63\u5728\u8fde\u63a5\u5b98\u65b9\u670d\u52a1\u5668\uff0c\u8bf7\u7a0d\u7b49\u3002</p></div><div class="bar"><div class="fill" id="fill"></div></div><div class="meta"><div class="row"><span class="pulse"></span><span id="stage">\u4e0b\u8f7d\u4e2d</span></div><span id="percent">0%</span></div></section><script>
window.__setUpdateProgress=function(data){var p=Math.max(0,Math.min(100,Math.round((data.percent||0)*100)));document.getElementById("title").textContent=data.title||"\u6b63\u5728\u66f4\u65b0";document.getElementById("detail").textContent=data.detail||"";document.getElementById("fill").style.width=p+"%";document.getElementById("percent").textContent=p+"%";document.getElementById("stage").textContent=data.stage||"\u4e0b\u8f7d\u4e2d"};
</script></body></html>`;
}

async function ensureUpdateProgressWindow() {
  if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
    updateProgressWindow.show();
    return updateProgressWindow;
  }

  updateProgressWindow = new BrowserWindow({
    width: 880,
    height: 126,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    title: "\u665a\u85b0\u66f4\u65b0",
    autoHideMenuBar: true,
    webPreferences: { sandbox: true }
  });
  updateProgressWindow.on("closed", () => {
    updateProgressWindow = undefined;
  });
  await updateProgressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(updateProgressHtml())}`);
  updateProgressWindow.show();
  return updateProgressWindow;
}

async function setUpdateProgress(percent: number, title: string, detail: string, stage = "\u4e0b\u8f7d\u4e2d") {
  const win = await ensureUpdateProgressWindow();
  BrowserWindow.getAllWindows().forEach((window) => {
    window.setProgressBar(percent > 0 && percent < 1 ? percent : -1);
  });
  await win.webContents.executeJavaScript(`window.__setUpdateProgress(${JSON.stringify({ percent, title, detail, stage })})`).catch(() => undefined);
}

async function sha256File(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

async function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: Uint8Array) {
  await new Promise<void>((resolve, reject) => {
    stream.write(Buffer.from(chunk), (error) => error ? reject(error) : resolve());
  });
}

async function finishStream(stream: ReturnType<typeof createWriteStream>) {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => error ? reject(error) : resolve());
  });
}

async function downloadUpdate(url: string, expectedSha256?: string) {
  const parsed = new URL(url);
  const fileName = decodeURIComponent(path.basename(parsed.pathname || "wanxun-update.exe"));
  if (!/\.exe$/i.test(fileName)) {
    throw new Error("\u5f53\u524d\u66f4\u65b0\u53ea\u652f\u6301\u5b98\u65b9\u5b89\u88c5\u5668\u3002");
  }

  const dir = path.join(app.getPath("userData"), "updates");
  mkdirSync(dir, { recursive: true });
  const targetPath = path.join(dir, fileName);
  const tempPath = `${targetPath}.download`;
  safeUnlink(tempPath);

  await setUpdateProgress(0.02, "\u6b63\u5728\u8fde\u63a5\u66f4\u65b0\u670d\u52a1\u5668", "\u6b63\u5728\u4ece\u665a\u85b0\u5b98\u65b9\u670d\u52a1\u5668\u83b7\u53d6\u5b89\u88c5\u5305\u3002", "\u8fde\u63a5\u4e2d");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(`\u66f4\u65b0\u5305\u4e0b\u8f7d\u5931\u8d25\uff08${response.status}\uff09\u3002`);
  }

  const total = Number(response.headers.get("content-length") || "0");
  const reader = response.body.getReader();
  const file = createWriteStream(tempPath);
  let downloaded = 0;
  let lastUiAt = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writeChunk(file, value);
      downloaded += value.byteLength;
      const now = Date.now();
      if (now - lastUiAt > 300) {
        lastUiAt = now;
        const percent = total > 0 ? Math.min(0.92, 0.06 + downloaded / total * 0.84) : 0.18;
        const downloadedMb = (downloaded / 1024 / 1024).toFixed(1);
        const totalText = total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : "";
        await setUpdateProgress(percent, "\u6b63\u5728\u4e0b\u8f7d\u66f4\u65b0", `\u5df2\u4e0b\u8f7d ${downloadedMb}${totalText}\uff0c\u8bf7\u4e0d\u8981\u5173\u95ed\u8f6f\u4ef6\u3002`, "\u4e0b\u8f7d\u4e2d");
      }
    }
    await finishStream(file);
  } catch (error) {
    file.destroy();
    safeUnlink(tempPath);
    throw error;
  }

  if (total > 0 && statSync(tempPath).size !== total) {
    safeUnlink(tempPath);
    throw new Error("\u66f4\u65b0\u5305\u4e0b\u8f7d\u4e0d\u5b8c\u6574\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002");
  }

  await setUpdateProgress(0.94, "\u6b63\u5728\u6821\u9a8c\u66f4\u65b0\u5305", "\u6b63\u5728\u6821\u9a8c\u5b98\u65b9\u66f4\u65b0\u5305\u5b8c\u6574\u6027\u3002", "\u6821\u9a8c\u4e2d");
  if (expectedSha256) {
    const actualSha256 = await sha256File(tempPath);
    if (actualSha256 !== expectedSha256.toUpperCase()) {
      safeUnlink(tempPath);
      throw new Error("\u66f4\u65b0\u5305\u6821\u9a8c\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u4e0b\u8f7d\u3002");
    }
  }

  safeUnlink(targetPath);
  renameSync(tempPath, targetPath);
  return targetPath;
}

function launchInstaller(filePath: string) {
  try {
    const child = spawn(filePath, [], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    void shell.openPath(filePath);
  }
}

export async function downloadAndInstallUpdate(url: string, expectedSha256?: string) {
  try {
    const filePath = await downloadUpdate(url, expectedSha256);
    await setUpdateProgress(1, "\u4e0b\u8f7d\u5b8c\u6210", "\u5b89\u88c5\u5668\u5df2\u7ecf\u6253\u5f00\uff0c\u665a\u85b0\u5c06\u81ea\u52a8\u9000\u51fa\u3002", "\u51c6\u5907\u5b89\u88c5");
    launchInstaller(filePath);
    setTimeout(() => app.quit(), 800);
    return { ok: true, filePath };
  } catch (error) {
    BrowserWindow.getAllWindows().forEach((window) => window.setProgressBar(-1));
    await setUpdateProgress(1, "\u66f4\u65b0\u5931\u8d25", error instanceof Error ? error.message : "\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002", "\u5931\u8d25");
    throw error;
  }
}
