//@ts-check
const runLoop = async ({
  messages,
  callLLM,
  singleToolCall,
  maxRequestRounds = 5,
  maxRetryRounds = 5,
  sleep = async (ms) => new Promise(r => setTimeout(r, ms)),
  verbose = false,
}) => {
  let msgList = [...messages];
  let stopFlag = false;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let requestRounds = 0;
  let retryRounds = 0;
  let stopReason;

  while (!stopFlag) {
    if (requestRounds >= maxRequestRounds) {
      console.warn("警告:达到最大请求轮数，循环结束");
      stopReason = "max_rounds";
      stopFlag = true;
      break;
    }

    let responseResult;
    try {
      if (verbose) console.log("------------ 发起第", requestRounds+1, "轮请求 ------------\n", msgList);
      responseResult = await callLLM(msgList);
      requestRounds += 1;
    } catch (e) {
      if (e.cause?.status === 429) {
        if (retryRounds >= maxRetryRounds) {
          console.warn("警告:请求过于频繁且超过最大重试次数"); // 但设置 3s 方便调试
          stopReason = "retry_exhausted";
          break;
        }
        console.warn("警告:请求过于频繁，过 3s 后重试"); // 但设置 3s 方便调试
        await sleep(3000);
        retryRounds += 1;
        continue;
      } else if (e.cause?.status === 400) {
        console.warn("警告:请求参数错误，检查输入");
        stopFlag = true;
        stopReason = "http_400";
        break;
      } else {
        console.error("警告:其他错误:", e);
        stopFlag = true;
        stopReason = "other_error";
        break;
      }
    }

    // 非流式
    const choice = responseResult.choices?.[0];
    // console.log("choice:", choice);
    if (!choice || !choice.message) {
      console.error("响应缺少 choices或message:", responseResult);
      stopReason = "invalid_response";
      break;
    }

    // 本应该直接 push choice.message, 这里暂时去除 reasoning_content 以节省 token
    msgList.push({
      role: "assistant",
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    });

    if (typeof responseResult.usage?.prompt_tokens === 'number') totalPromptTokens += responseResult.usage.prompt_tokens;
    if (typeof responseResult.usage?.completion_tokens === 'number') totalCompletionTokens += responseResult.usage.completion_tokens;

    if (verbose) {
      console.log("回复:", choice.message?.content);
      console.log("结束原因:", choice.finish_reason);
      console.log("role:", choice.message?.role);
      console.log("工具调用:", choice.message?.tool_calls);
    }

    if (choice.finish_reason === "stop") {
      stopReason = "stop";
      stopFlag = true;
    } else if (choice.finish_reason === "tool_calls" && choice.message?.tool_calls?.length > 0) {
      for (const tool_call of choice.message?.tool_calls) {
        const rawMsg = { role: "tool", tool_call_id: tool_call.id, content: "" };
        const result = await singleToolCall(tool_call);
        if (verbose) console.log("*** ", tool_call.function.name, "工具调用结果:", result);
        msgList.push({ ...rawMsg, content: result });
      }
    } else {
      console.warn("警告:返回异常 finish_reason, 停止循环");
      stopFlag = true;
      stopReason = "other_error";
      break;
    }
  }

  if (verbose) console.log("循环结束, 输入 token:", totalPromptTokens);
  if (verbose) console.log("循环结束, 输出 token:", totalCompletionTokens);
  return { messages: msgList, stopReason, rounds: requestRounds, retries: retryRounds, totalPromptTokens, totalCompletionTokens };
};

export default runLoop;
