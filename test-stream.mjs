import assert from "node:assert";
import { mergeToolCallDeltas } from "./stream.mjs";

// 测试1:单个工具的 arguments 被切成 3 片，id/name 只在第一片出现
// (这正是真实 API 偶发、但客户端无法稳定复现的那个 case — 用 fixture 钉死)
{
  const acc = [];
  mergeToolCallDeltas(acc, [
    { index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: "" } },
  ]);
  mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: '{"pa' } }]);
  mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: 'th":"x.txt"}' } }]);

  // 断言来自规格,不是实现
  assert.strictEqual(acc[0].id, "call_1", "id 应取第一片,不被后续 undefined 覆盖");
  assert.strictEqual(acc[0].function.name, "read_file", "name 应取第一片,不被后续 undefined 覆盖");
  assert.strictEqual(acc[0].function.arguments, '{"path":"x.txt"}', "arguments 三片按序拼接成合法 JSON");
  console.log("✅ 测试1:单工具三片拼接");
}

// 测试2:两个工具交错分片,且后续分片乱序到达 — 验证用 index 定位而非 push
{
  const acc = [];
  mergeToolCallDeltas(acc, [
    { index: 0, id: "c0", type: "function", function: { name: "list_dir", arguments: "" } },
    { index: 1, id: "c1", type: "function", function: { name: "read_file", arguments: "" } },
  ]);
  // 故意先给 index 1 的参数,再给 index 0 的 — 乱序
  mergeToolCallDeltas(acc, [{ index: 1, function: { arguments: '{"path":"a"}' } }]);
  mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: '{"path":"."}' } }]);

  assert.strictEqual(acc[0].function.name, "list_dir");
  assert.strictEqual(acc[0].function.arguments, '{"path":"."}', "index 0 的参数没串到 index 1");
  assert.strictEqual(acc[1].function.name, "read_file");
  assert.strictEqual(acc[1].function.arguments, '{"path":"a"}', "index 1 的参数没串到 index 0");
  console.log("✅ 测试2:两工具交错且乱序,按 index 各归各位");
}

console.log("全部通过");
