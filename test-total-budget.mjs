import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import runLoop from "./loop.mjs";

const base = { messages: [], singleToolCall: async () => "ok" };

test("退避的非取消错误不能被吞掉后继续重试", async () => {
  const failure = new Error("sleep 实现失败");
  let calls = 0;
  const outcome = await runLoop({
    ...base,
    totalTaskTimeoutMs: 1000,
    sleep: async () => { throw failure; },
    callLLM: async () => {
      calls++;
      throw Object.assign(new Error("限流", { cause: { status: 429 } }), { kind: "http" });
    },
  }).then(value => ({ value }), error => ({ error }));
  assert.equal(outcome.error, failure, "未识别的退避错误应原样向上传播");
  assert.equal(calls, 1);
});

test("请求中总预算耗尽：返回 task_timeout，取消请求且不重试", async () => {
  let calls = 0;
  let aborted = false;
  const started = performance.now();
  const result = await runLoop({
    ...base,
    totalTaskTimeoutMs: 40,
    requestTimeoutMs: 1000,
    callLLM: async (_, { signal }) => {
      calls++;
      try {
        await sleep(1500, undefined, { signal });
        throw new Error("慢请求不应完成");
      } catch (cause) {
        aborted = signal.aborted;
        throw Object.assign(new Error("网络错误", { cause }), { kind: "network" });
      }
    },
  });
  assert.equal(result.stopReason, "task_timeout");
  assert.equal(result.errorDetail.kind, "timeout");
  assert.equal(result.rounds, 0);
  assert.equal(result.retries, 0);
  assert.equal(calls, 1);
  assert.equal(aborted, true);
  assert.ok(performance.now() - started < 800, "应在单次请求超时之前结束");
});

test("退避中总预算耗尽：返回 task_timeout，不能向调用方抛 AbortError", async () => {
  let calls = 0;
  const started = performance.now();
  // 捕获结果后再断言，确保失败时也能检查是否发生额外请求。
  const outcome = await runLoop({
    ...base,
    totalTaskTimeoutMs: 40,
    requestTimeoutMs: 1000,
    callLLM: async () => {
      calls++;
      throw Object.assign(new Error("限流", { cause: { status: 429 } }), { kind: "http" });
    },
  }).then(value => ({ value }), error => ({ error }));
  assert.equal(calls, 1);
  assert.ok(performance.now() - started < 800, "不能等完 1000ms 退避");
  assert.equal(outcome.error, undefined, "应返回结构化结束结果");
  assert.equal(outcome.value.stopReason, "task_timeout");
  assert.equal(outcome.value.errorDetail.kind, "timeout");
  assert.equal(outcome.value.retries, 0);
});

test("单次请求先超时：仍返回 request_timeout", async () => {
  const result = await runLoop({
    ...base,
    totalTaskTimeoutMs: 1000,
    requestTimeoutMs: 20,
    callLLM: async (_, { signal }) => sleep(1500, undefined, { signal }),
  });
  assert.equal(result.stopReason, "request_timeout");
  assert.equal(result.retries, 0);
});

test("异常退出也必须清理总计时器，不能在任务结束后再取消 signal", async () => {
  let savedSignal;
  const toolError = new Error("工具意外失败");
  await assert.rejects(runLoop({
    ...base,
    totalTaskTimeoutMs: 40,
    requestTimeoutMs: 1000,
    callLLM: async (_, { signal }) => {
      savedSignal = signal;
      return { choices: [{ finish_reason: "tool_calls", message: {
        role: "assistant", content: "", tool_calls: [
          { id: "t1", type: "function", function: { name: "fake", arguments: "{}" } },
        ],
      } }] };
    },
    singleToolCall: async () => { throw toolError; },
  }), error => error === toolError);
  await sleep(80);
  assert.equal(savedSignal.aborted, false, "退出后总计时器仍在触发");
});
