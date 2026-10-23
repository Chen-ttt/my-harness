import { resolveInRoot } from "./guard.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { symlink, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = path.join(import.meta.dirname, "..");

// ---- fixture:自建自清。root 外造一个真实目录,root 内放一个指向它的符号链接 ----
const outsideDir = path.join(tmpdir(), "guard-test-outside");
const linkPath = path.join(root, "guard-test-link");
await rm(outsideDir, { recursive: true, force: true });
await mkdir(outsideDir, { recursive: true });
await symlink(outsideDir, linkPath, "dir");

try {
  // 用例 1:正常相对路径 → 放行,返回解析后的绝对路径
  assert.equal(await resolveInRoot("ask.mjs"), path.join(root, "ask.mjs"));

  // 用例 2:爬出 workspace → 拦截
  assert.equal(await resolveInRoot("../../.ssh/id_rsa"), null);

  // 用例 3:同级目录前缀绕过 → 拦截(`${root}-test` 是 root 的兄弟目录,不是子路径)
  assert.equal(await resolveInRoot(`${root}-test`), null);

  // 用例 4:"." → 放行且等于 root 本身
  assert.equal(await resolveInRoot("."), root);

  // 用例 5:root 内的绝对路径 → 放行(path.resolve 遇绝对路径直接采用)
  assert.equal(await resolveInRoot(path.join(root, "tools")), path.join(root, "tools"));

  // 用例 6:root 内但不存在的路径 → 仍放行(ENOENT 分支返回词法路径)
  // 不存在 = 没有链接可展开 = 攻击无法成立,把"不存在"留给 fs 去报,语义才诚实
  assert.equal(await resolveInRoot("no-such-file.txt"), path.join(root, "no-such-file.txt"));

  // 用例 7:越界且不存在的路径 → 拦截,而不是 ENOENT
  // 钉死"词法门在前"的顺序:越界就是越界,不因不存在而洗白
  assert.equal(await resolveInRoot("../../no-such-outside-file"), null);

  // 用例 8:符号链接指向 root 外 → 拦截(漏洞回归测试,直接测 guard 层)
  assert.equal(await resolveInRoot("guard-test-link"), null);

  console.log("8/8 通过");
} finally {
  // teardown:测试自己造的环境自己清,不依赖、不残留
  await rm(linkPath, { force: true });
  await rm(outsideDir, { recursive: true, force: true });
}
