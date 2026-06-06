import { dialog, ipcMain } from "electron";
import { access, writeFile } from "node:fs/promises";
import type { ImageRecord, SaveImageResult } from "../../src/lib/desktopApi.js";

export function registerImageIpc() {
  ipcMain.handle("images:save", async (_event, record: ImageRecord): Promise<SaveImageResult> => {
    if (!record.imageUrl) {
      return { saved: false, record };
    }

    const result = await dialog.showSaveDialog({
      title: "保存这张梦",
      defaultPath: `dream-${record.id}.png`,
      filters: [{ name: "PNG 图片", extensions: ["png"] }]
    });

    if (result.canceled || !result.filePath) {
      return { saved: false, record };
    }

    if (record.imageUrl.startsWith("data:image")) {
      const base64 = record.imageUrl.split(",")[1] ?? "";
      await writeFile(result.filePath, Buffer.from(base64, "base64"));
    } else {
      const imageResponse = await fetch(record.imageUrl);
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      await writeFile(result.filePath, buffer);
    }

    await access(result.filePath);
    const savedRecord = { ...record, localPath: result.filePath };
    return { saved: true, localPath: result.filePath, record: savedRecord };
  });
}
