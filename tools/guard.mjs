import path from "node:path";
import { realpath } from "node:fs/promises";

export async function resolveInRoot(p) {
  const root = path.join(import.meta.dirname, "..");
  const resolved = path.resolve(root, p);

  // 第一道门(词法):纯字符串检查,拦下明显越界的路径(含同级目录前缀绕过)。
  // 必须在 realpath 之前:越界路径不该被报成"文件不存在",还省一次磁盘 I/O。
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }

  // 第二道门(物理):realpath 展开符号链接,对真实路径再做同样的边界检查。
  // 两道门串联(AND):任何一道否决,整体拦截—绝不能 || 并联。
  let realPath;
  try {
    realPath = await realpath(resolved);
  } catch (e) {
    if (e.code === "ENOENT") {
      // 决定2:路径不存在 → 链接攻击无法成立(链接目标必须真实存在才能被展开),
      // 放行词法路径,让 fs 去报真实的"不存在"—语义诚实,且不打开新洞。
      return resolved;
    }
    // 决定3:EACCES 等其他错误 → 无法证明路径合法,fail closed(查不了就拒绝),
    // 抛给工具层转为错误文本,绝不默认放行。
    throw e;
  }

  if (realPath === root || realPath.startsWith(root + path.sep)) {
    // 决定1:返回 realPath 而非 resolved — 后续 readFile/readdir 直接用已展开的路径,
    // 缩小 TOCTOU 窗口(检查与使用之间链接被替换的竞态)。
    return realPath;
  }
  return null;
}
