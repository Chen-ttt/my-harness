import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { readFileTool } from "./read-file.mjs";

test("真实 readFile 启动后取消：底层拒绝，工具不转换为错误字符串", async () => {
  const directory = await fs.mkdtemp(path.join(import.meta.dirname, ".cancel-test-"));
  const filePath = path.join(directory, "large.txt");
  const originalReadFile = fs.readFile;
  const controller = new AbortController();
  const reason = new Error("task_timeout");
  let immediate;
  let started = false;
  let settled = false;
  let abortedWhilePending = false;
  let receivedSignal;
  let readError;

  try {
    const handle = await fs.open(filePath, "w");
    try {
      // 稀疏文件提供多轮真实读取，不向磁盘写入整块测试数据。
      await handle.truncate(32 * 1024 * 1024);
    } finally {
      await handle.close();
    }

    // 只观察和安排取消，实际读取仍调用 Node 的原始 readFile。
    fs.readFile = async (target, options) => {
      if (target !== filePath) return originalReadFile(target, options);
      receivedSignal = options?.signal;
      const pending = originalReadFile(target, options);
      started = true;
      immediate = setImmediate(() => {
        abortedWhilePending = !settled;
        controller.abort(reason);
      });
      try {
        return await pending;
      } catch (error) {
        readError = error;
        throw error;
      } finally {
        settled = true;
      }
    };
    syncBuiltinESMExports();

    let toolError;
    try {
      await readFileTool({ path: filePath }, { signal: controller.signal });
    } catch (error) {
      toolError = error;
    }

    assert.equal(started, true, "必须经过路径解析，启动真实 readFile");
    assert.equal(receivedSignal, controller.signal, "必须将同一个 signal 交给底层");
    assert.equal(abortedWhilePending, true, "必须在读取 Promise 未完成时取消");
    assert.equal(readError?.name, "AbortError", "必须由底层读取拒绝，而非只靠读取后的检查");
    assert.equal(readError.cause, reason);
    assert.equal(toolError, readError, "工具应原样传播底层取消异常");
  } finally {
    clearImmediate(immediate);
    fs.readFile = originalReadFile;
    syncBuiltinESMExports();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
