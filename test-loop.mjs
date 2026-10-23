import assert from "node:assert";
import runLoop from "./loop.mjs";

// — 响应构造器:让测试意图一眼可读 —
const mkToolCallResp = (calls) => ({
  choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: "", tool_calls: calls } }],
  usage: { prompt_tokens: 100, completion_tokens: 10 },
});
const mkStopResp = (content) => ({
  choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
  usage: { prompt_tokens: 200, completion_tokens: 20 },
});
const mkFinishResp = (reason) => ({
  choices: [{ finish_reason: reason, message: { role: "assistant", content: "" } }],
  usage: { prompt_tokens: 50, completion_tokens: 5 },
});
const mkCall = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

// 按脚本依次返回;多调一次就报错(防止"模型被调了意料之外的次数"悄悄溜过)
const scriptedModel = (script) => {
  let i = 0;
  const fn = async () => {
    if (i >= script.length) throw new Error(`callLLM 被调用了第 ${i + 1} 次,超出脚本长度 ${script.length}`);
    const step = script[i++];
    if (step instanceof Error) throw step;
    return step;
  };
  fn.calls = () => i;
  return fn;
};
const http = (status) => new Error("请求失败", { cause: { status } });
const fakeTool = async (tc) => `[假工具结果] ${tc.function.name}`;
const base = { messages: [{ role: "user", content: "q" }], singleToolCall: fakeTool, verbose: false,
  sleep: async () => {}, // ← 关键:测试里不真的等 3 秒
};

let pass = 0;
const it = async (name, fn) => {
  try { await fn(); console.log("✅", name); pass++; }
  catch (e) { console.error("❌", name, "", e.message); }
};

// 1. happy path:tool_calls → stop,共 2 轮
await it("tool_calls 后继续,stop 后结束", async () => {
  const model = scriptedModel([
    mkToolCallResp([mkCall("c1", "list_dir", { path: "." })]),
    mkStopResp("有 2 个 md 文件"),
  ]);
  const r = await runLoop({ ...base, callLLM: model });
  assert.strictEqual(r.stopReason, "stop");
  assert.strictEqual(r.rounds, 2);
  assert.strictEqual(model.calls(), 2);
  // 消息顺序:user → assistant(tool_calls) → tool → assistant(stop)
  assert.deepStrictEqual(r.messages.map(m => m.role), ["user", "assistant", "tool", "assistant"]);
  assert.strictEqual(r.totalPromptTokens, 300);
  assert.strictEqual(r.totalCompletionTokens, 30);
});

// 2. 一轮多个 tool_calls → 必须追加 N 条 tool 消息,且 tool_call_id 一一对应
await it("一轮 3 个 tool_calls 追加 3 条 tool 消息", async () => {
  const calls = [
    mkCall("a", "list_dir", { path: "." }),
    mkCall("b", "read_file", { path: "x.md" }),
    mkCall("c", "read_file", { path: "y.md" }),
  ];
  const r = await runLoop({ ...base, callLLM: scriptedModel([mkToolCallResp(calls), mkStopResp("done")]) });
  const toolMsgs = r.messages.filter(m => m.role === "tool");
  assert.strictEqual(toolMsgs.length, 3);
  assert.deepStrictEqual(toolMsgs.map(m => m.tool_call_id), ["a", "b", "c"]);
});

// 3. maxRequestRounds 硬上限:模型永远要调工具,也必须停
await it("maxRequestRounds 拦得住无限工具调用", async () => {
  const forever = async () => mkToolCallResp([mkCall("x", "list_dir", { path: "." })]);
  const r = await runLoop({ ...base, callLLM: forever, maxRequestRounds: 3 });
  assert.strictEqual(r.stopReason, "max_rounds");
  assert.strictEqual(r.rounds, 3);
});

// 4. 持续"429 重试耗尽后放弃",且调用次数 = 1 + maxRetryRounds(不是无限)
await it("429 重试耗尽后放弃", async () => {
  const model = scriptedModel(Array(20).fill(null).map(() => http(429)));
  const r = await runLoop({ ...base, callLLM: model, maxRetryRounds: 3 });
  assert.strictEqual(r.stopReason, "retry_exhausted");
  assert.strictEqual(model.calls(), 4); // 首次 + 3 次重试
});

// 5. 400 不重试,立即停
await it("400 立即放弃不重试", async () => {
  const model = scriptedModel([http(400), mkStopResp("不该走到这")]);
  const r = await runLoop({ ...base, callLLM: model });
  assert.strictEqual(r.stopReason, "http_400");
  assert.strictEqual(model.calls(), 1);
});

// 6. 异常 finish_reason 要终止,且停止原因可区分
for (const reason of ["length", "sensitive", "model_context_window_exceeded", "???"]) {
  await it(`finish_reason=${reason} 终止循环`, async () => {
    const r = await runLoop({ ...base, callLLM: scriptedModel([mkFinishResp(reason)]) });
    assert.notStrictEqual(r.stopReason, "stop");
    assert.strictEqual(r.rounds, 1);
  });
}

// 7. 不污染调用方的 messages
await it("不修改传入的 messages 数组", async () => {
  const inputMsgs = [...base.messages];
  const model = scriptedModel([mkStopResp("ok")]);
  await runLoop({ ...base, messages: inputMsgs, callLLM: model });
  // 校验原数组不变
  assert.deepStrictEqual(inputMsgs, base.messages);
});
