import { readdir } from "node:fs/promises";
import { resolveInRoot } from "./guard.mjs";

export async function listDirTool({ path: dirPath }) {
  try {
    const resolvedPath = await resolveInRoot(dirPath);
    if (!resolvedPath) return "[工具错误] 目录路径越界: " + dirPath;
    const arr = await readdir(resolvedPath);
    return '[工具成功] 以下是文件列表。\n' + arr.join('\n');
  } catch (e) {
    return `[工具错误] ${e.code}: ${e.message}`;
  }
}
