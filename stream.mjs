// 流式工具调用分片的拼接(纯函数,不碰网络,方便 fixture 测试)

// 把一片 delta.tool_calls 合并进累加器 acc(原地修改 acc)。
// acc 下标 = tool_call 的 index;每项形状与"非流式"保持一致:
// { id, type, function: { name, arguments } }  // arguments 保持未解析的字符串
// 规则:
// - id / type / name 取"第一次出现":后续分片里这些字段缺失(undefined),不能把已有值覆盖掉;
// - arguments 是被切开的字符串片段,按到达顺序拼接(+=);
// - 用 tc.index 定位,而不是 push — 分片不保证按序到达,且同一个 call 的多片要合并到同一项。
export function mergeToolCallDeltas(acc, deltaToolCalls) {
  if (!Array.isArray(deltaToolCalls)) return acc; // 这一片没有工具调用,直接跳过
  for (const tc of deltaToolCalls) {
    const i = tc.index;
    if (acc[i] === undefined) {
      acc[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
    }
    const slot = acc[i];
    if (tc.id) slot.id = tc.id;                     // 有值才赋,保第一次
    if (tc.type) slot.type = tc.type;
    if (tc.function?.name) slot.function.name = tc.function.name;   // 同上
    if (tc.function?.arguments) slot.function.arguments += tc.function.arguments; // 只拼 arguments
  }
  return acc;
}
