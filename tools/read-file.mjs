import { readFile } from "node:fs/promises";
import { resolveInRoot } from "./guard.mjs";

export async function readFileTool({ path: filePath }) {
  try {
    const resolvedPath = await resolveInRoot(filePath);
    if (!resolvedPath) return "[工具错误] 文件路径越界: " + filePath;
    const content = await readFile(resolvedPath, "utf8");
    return '[工具成功] 以下是文件内容。\n' + content;
  } catch (e) {
    return `[工具错误] ${e.code}: ${e.message}`;
  }
}
