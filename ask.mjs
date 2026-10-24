import { tools, toolImpls } from "./tools/index.mjs";
import { mergeToolCallDeltas } from "./stream.mjs";
import runLoop from "./loop.mjs";
import { validateParams } from "./validate-params.mjs";

const apiKey = process.env.ZHIPU_API_KEY;
if (!apiKey) {
  console.error("缺少环境变量 ZHIPU_API_KEY");
  process.exit(1);
}

console.log("开始执行");

const MAX_REQUEST_ROUNDS = 5;
const MAX_RETRY_ROUNDS = 5;

let msgList = [
  { role: "user", content: "当前目录下有几个md文件" },
];
// let msgList = [
//   { role: "user", content: "你来猜测我的性别,可以向我提问必要信息" },
// ];

const callLLM = async (messages) => {
  // 网络断开、DNS 失败、超时这类"根本没拿到响应"的情况, fetch 会直接抛异常
  let res;
  try {
    res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "glm-5.3-flash",
        messages: messages,
        stream: false,
        reasoning_effort: "low",
        max_tokens: 2048,
        tools: tools,
        tool_choice: "auto",
      }),
    });
  } catch (e) {
    throw new Error("网络错误", { cause: e });
  }
  // console.log("HTTP 响应:", res);
  const resText = await res.text(); // .text() 读取响应体, 并把它当作字符串返回
  // res.ok 是 Response 对象的布尔属性: HTTP 状态码在 200--299 之间时为 true, 否则为 false.
  // 因此, 走到这个分支说明 服务器有响应, 但返回了非 2xx 的失败状态码
  if (!res.ok) {
    console.error("请求失败:", resText);
    throw new Error("请求失败", { cause: { status: res.status, statusText: res.statusText } });
  }
  return JSON.parse(resText);
};

const callLLMStream = async (messages) => {
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "glm-5.3-flash",
      messages,
      stream: true,
      reasoning_effort: "low",
      max_tokens: 2048,
      tools: tools,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) {
    console.error("请求失败:", await res.text());
    throw new Error("请求失败", { cause: res.statusText });
  }

  const decoder = new TextDecoder();
  let buffer = "";

  // 累积器
  let content = "";
  let reasoning = "";

  const toolCalls = []; // 下标=tool_call 的 index,每项 { id, name, args }
  let finishReason = null;
  let usage = null;
  let role = "";

  let flag = 0;
  for await (const chunk of res.body) {
    flag += 1;
    const cur = decoder.decode(chunk, { stream: true });
    buffer += cur;
    // console.log(`*** 循环内: flag: ${flag}, - cur: ${cur}, - nlOuter: ${cur.indexOf("\n")}, ***`)

    // 切出完整的行,不完整的行留在 buffer
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim(); // trim 去掉字符串首尾的空白字符, 包括空格、制表符\t、换行\n、回车\r 等
      buffer = buffer.slice(nl + 1);
      if (line === "") continue;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim(); // 去掉 "data:"
      if (payload === "[DONE]") { buffer = ""; break; } // 流结束
      const obj = JSON.parse(payload);
      const choice = obj.choices?.[0];
      const delta = choice?.delta;
      if (delta?.role) role = delta.role;
      if (obj.usage) usage = obj.usage;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (!delta) continue;

      // === 填空1:累积 content 和 reasoning(delta.content / delta.reasoning_content 可能为 undefined)===
      content += delta.content || "";
      reasoning += delta.reasoning_content || "";
      // === 填空2:累积 tool_calls 分片 ===
      if (delta.tool_calls) mergeToolCallDeltas(toolCalls, delta.tool_calls);
    }
  }

  console.log("content: ", content)
  console.log("reasoning: ", reasoning)

  return {
    choices: [{
      index: 0,
      finish_reason: finishReason,
      message: {
        role: role || "assistant",
        content: content || "",
        reasoning_content: reasoning || "",
        tool_calls: toolCalls,
      }
    }],
    usage
  };
};

const singleToolCall = async (tool_call) => {
  const fnIndex = tools.findIndex(tool => tool.function.name === tool_call.function.name);
  // console.log("fnIndex:", fnIndex);

  if (fnIndex < 0) {
    console.error("未知工具:", tool_call.function.name);
    return "工具调用失败 - 未知工具: " + tool_call.function.name;
  }
  let params = {};
  try {
    params = JSON.parse(tool_call.function.arguments);
  } catch (e) {
    console.error("params解析失败:", e);
    return "工具调用失败 - params解析失败: " + e.message;
  }

  const validateParamsResult = validateParams(params, tools[fnIndex]);
  if (validateParamsResult !== null) return validateParamsResult;

  const toolFn = toolImpls[tool_call.function.name];
  if (!toolFn) {
    console.error("工具未注册实现:", tool_call.function.name);
    return "工具调用失败 - 工具未注册实现: " + tool_call.function.name;
  }

  return await toolFn(params);
};

// const data = await callLLMStream(msgList);
// console.log("最终完整的返回结果: ", data, "\n message: ", data.choices[0].message);

const result = await runLoop({
  messages: msgList,
  callLLM,
  singleToolCall,
  maxRequestRounds: MAX_REQUEST_ROUNDS,
  maxRetryRounds: MAX_RETRY_ROUNDS,
});

console.dir(result, { depth: null });

/// 以下部分调试异常 case 使用, 暂时注释
// const choice = {
//   finish_reason: 'tool_calls',
//   index: 0,
//   message: {
//     content: '',
//     reasoning_content: 'Need path; "当前目录" ambiguous — try listing "." or /home/user? Use ".',
//     role: 'assistant',
//     tool_calls: [
//       {
//         function: { arguments: '{"path":"."}', name: 'list_dir' },
//         id: 'call_-7182870148682874596',
//         index: 0,
//         type: 'function'
//       }
//     ]
//   }
// }
