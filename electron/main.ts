import { app, BrowserWindow, Menu, Tray } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerChatIpc } from "./ipc/chat.js";
import { registerDreamIpc } from "./ipc/dream.js";
import { registerImageIpc } from "./ipc/image.js";
import { registerHuayingIpc } from "./ipc/huaying.js";
import { registerSettingsIpc } from "./ipc/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "assets/icons/logo.png")
  : path.join(__dirname, "../../assets/icons/logo.png");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

if (!app.isPackaged) {
  const devUserData = path.join(os.tmpdir(), "ai-poetry-garden-electron-dev");
  fs.mkdirSync(devUserData, { recursive: true });
  app.setPath("userData", devUserData);
  app.setPath("cache", path.join(devUserData, "Cache"));
}

registerSettingsIpc();
registerChatIpc();
registerDreamIpc();
registerHuayingIpc();
registerImageIpc();

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "\u665a\u85b0",
    icon: appIconPath,
    backgroundColor: "#fff7ed",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow = win;

  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
    if (process.env.OPEN_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

function createTray() {
  if (tray) return;
  tray = new Tray(appIconPath);
  tray.setToolTip("\u665a\u85b0");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "\u663e\u793a\u665a\u85b0", click: () => void createWindow() },
    {
      label: "\u9000\u51fa",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", () => void createWindow());
}

app.whenReady().then(() => {
  createTray();
  void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
