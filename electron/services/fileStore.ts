import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const dataDir = () => app.isPackaged
  ? path.join(path.dirname(app.getPath("exe")), "用户数据")
  : app.getPath("userData");
export const chatDir = () => path.join(dataDir(), "轻语");
export const dreamDir = () => path.join(dataDir(), "绘梦");
export const huayingDir = () => path.join(dataDir(), "花映");

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(path.join(dataDir(), fileName), "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(fileName: string, value: T): Promise<T> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(path.join(dataDir(), fileName), JSON.stringify(value, null, 2), "utf-8");
  return value;
}
