import { readFileTool, listDirTool } from "./index.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { symlink, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = path.join(import.meta.dirname, "..");

// ---- fixture:漏洞回归测试的环境(自建自清) ----
// root 外造一个真实目录 + 假私钥,root 内放一个指向它的符号链接(传送门)
const outsideDir = path.join(tmpdir(), "tool-test-outside");
const linkPath = path.join(root, "fakelink");
await rm(outsideDir, { recursive: true, force: true });
await mkdir(outsideDir, { recursive: true });
await writeFile(path.join(outsideDir, "id_rsa"), "FAKE-PRIVATE-KEY");
await rm(linkPath, { force: true }); // 清掉此前手工实验可能残留的同名链接
await symlink(outsideDir, linkPath, "dir");

try {
  // 实验 1:读一个存在的文件
  const r1 = await readFileTool("ask.mjs");
  assert.ok(r1.includes("apiKey"));
  assert.equal(typeof r1, "string");

  // 实验 2:读一个不存在的文件 - ENOENT(guard 放行词法路径,由 fs 报真实原因)
  const r2 = await readFileTool(path.join(root, "no-such-file.txt"));
  assert.ok(r2.includes("ENOENT"));
  assert.equal(typeof r2, "string");

  // 实验 3:把目录当文件读 - EISDIR
  const r3 = await readFileTool(path.join(root, "tools"));
  assert.ok(r3.includes("EISDIR"));
  assert.equal(typeof r3, "string");

  // ---------- 工具2: 列出目录内容 ----------
  // 实验 4:列一个存在的目录
  const r4 = await listDirTool(root);
  assert.ok(r4.includes("ask.mjs"));
  assert.equal(typeof r4, "string");

  // 实验 5:列一个不存在的目录 - ENOENT
  const r5 = await listDirTool(path.join(root, "t"));
  assert.ok(r5.includes("ENOENT"));
  assert.equal(typeof r5, "string");

  // 实验 6:列一个文件 - ENOTDIR
  const r6 = await listDirTool(path.join(root, "ask.mjs"));
  assert.ok(r6.includes("ENOTDIR"));
  assert.equal(typeof r6, "string");

  // 实验 7:读一个越界文件 → 必须报"越界"(词法门在 realpath 之前,不能报 ENOENT)
  const r7 = await readFileTool("../../.ssh/id_rsa");
  assert.ok(r7.includes("越界"));
  assert.equal(typeof r7, "string");

  // 实验 8:列一个越界目录 → 必须报"越界"
  const r8 = await listDirTool("../../.ssh");
  assert.ok(r8.includes("越界"));
  assert.equal(typeof r8, "string");

  // 实验 9(漏洞回归测试):符号链接必须被展开后检查
  // 历史漏洞:词法 guard 只查字符串,fakelink 在 root 内被放行,fs 跟随链接读出 root 外文件。
  // 修复后必须报"越界"。这条测试永远看守这个洞—谁改坏 guard,它第一个红。
  const r9 = await readFileTool("fakelink/id_rsa");
  assert.ok(r9.includes("越界"));
  assert.equal(typeof r9, "string");

  console.log("9/9 通过");
} finally {
  // teardown:无论断言成败,环境必清
  await rm(linkPath, { force: true });
  await rm(outsideDir, { recursive: true, force: true });
}
