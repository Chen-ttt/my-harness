import { readFile } from "node:fs/promises";
import { resolveInRoot } from "./guard.mjs";

export async function readFileTool({ path: filePath }, { signal } = {}) {
  try {
    signal?.throwIfAborted();

    const resolvedPath = await resolveInRoot(filePath);
    if (!resolvedPath) return "[工具错误] 文件路径越界: " + filePath;

    signal?.throwIfAborted();

    const content = await readFile(resolvedPath, {
      encoding: "utf8",
      signal,
    });

    signal?.throwIfAborted();
    return '[工具成功] 以下是文件内容。\n' + content;
  } catch (e) {
    if (signal?.aborted) {
      throw e;
    } else return `[工具错误] ${e.code}: ${e.message}`;
  }
}
