import { readdir } from "node:fs/promises";
import { resolveInRoot } from "./guard.mjs";

export async function listDirTool({ path: dirPath }, { signal } = {}) {
  try {
    signal?.throwIfAborted();

    const resolvedPath = await resolveInRoot(dirPath);
    if (!resolvedPath) return "[工具错误] 目录路径越界: " + dirPath;

    signal?.throwIfAborted();
    // readdir 不支持取消，只能在等待前后检查。
    const arr = await readdir(resolvedPath);

    signal?.throwIfAborted();
    return '[工具成功] 以下是文件列表。\n' + arr.join('\n');
  } catch (e) {
    if (signal?.aborted) {
      throw e;
    } else return `[工具错误] ${e.code}: ${e.message}`;
  }
}
