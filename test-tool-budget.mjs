import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import runLoop from "./loop.mjs";

const response = (count) => ({ choices: [{
  finish_reason: "tool_calls",
  message: { role: "assistant", content: "", tool_calls:
    Array.from({ length: count }, (_, i) => ({
      id: `t${i}`, type: "function", function: { name: "fake", arguments: "{}" },
    })),
  },
}] });
const stopResponse = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }] };

test("慢工具响应取消：第二个工具和下次模型请求都不能启动", async () => {
  let modelCalls = 0;
  const toolCalls = [];
  let cancelled = false;
  const started = performance.now();
  const result = await runLoop({
    messages: [], totalTaskTimeoutMs: 40,
    callLLM: async () => { modelCalls++; return response(2); },
    singleToolCall: async (call, { signal }) => {
      toolCalls.push(call.id);
      try {
        await sleep(1500, undefined, { signal });
        return "completed";
      } catch (error) {
        cancelled = signal.aborted;
        throw error;
      }
    },
  });
  assert.equal(cancelled, true);
  assert.equal(result.stopReason, "task_timeout");
  assert.equal(result.errorDetail.kind, "timeout");
  assert.deepEqual(toolCalls, ["t0"]);
  assert.equal(modelCalls, 1);
  assert.equal(result.messages.filter(m => m.role === "tool").length, 0);
  assert.ok(performance.now() - started < 800);
});

for (const count of [2, 1]) {
  test(`${count} 个工具，首个工具忽略取消后返回：不得启动后续工作`, async () => {
    let modelCalls = 0;
    const toolCalls = [];
    let expiredOnReturn = false;
    const result = await runLoop({
      messages: [], totalTaskTimeoutMs: 20,
      callLLM: async () => ++modelCalls === 1 ? response(count) : stopResponse,
      singleToolCall: async (call, { signal }) => {
        toolCalls.push(call.id);
        // 不要求强制打断此操作，只要求它返回后不再启动新工作。
        await sleep(60);
        expiredOnReturn = signal.aborted;
        return "late result";
      },
    });
    assert.equal(expiredOnReturn, true);
    assert.deepEqual(toolCalls, ["t0"]);
    assert.equal(modelCalls, 1, "总预算已取消，却再次调用了模型");
    assert.equal(result.stopReason, "task_timeout");
    assert.equal(result.errorDetail.kind, "timeout");
  });
}
