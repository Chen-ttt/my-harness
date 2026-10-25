//@ts-check
import { setTimeout as cancellableSleep } from "node:timers/promises";

const runLoop = async ({
  messages,
  callLLM,
  singleToolCall,
  maxRequestRounds = 5,
  maxRetryRounds = 5,
  sleep = (ms, signal) => cancellableSleep(ms, undefined, { signal }),
  requestTimeoutMs = 30000,
  totalTaskTimeoutMs = 300000,
  verbose = false,
}) => {
  let msgList = [...messages];
  let stopFlag = false;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let requestRounds = 0;
  let retryRounds = 0;
  let stopReason;
  let errorDetail = null;
  let stopDetail = null;

  const totalTaskController = new AbortController();
  const totalTaskTimer = setTimeout(() => {
    totalTaskController.abort(new Error("task_timeout"));
  }, totalTaskTimeoutMs);

  try {
    while (!stopFlag) {
      if (requestRounds >= maxRequestRounds) {
        console.warn("警告:达到最大请求轮数，循环结束");
        stopReason = "max_rounds";
        stopFlag = true;
        break;
      }

      let responseResult;
      const singleRequestController = new AbortController();
      // 总任务或单次请求信号任意一个被取消时，就取消
      const requestSignal = AbortSignal.any([
        totalTaskController.signal,
        singleRequestController.signal,
      ]);
      try {
        if (verbose) console.log("------------ 发起第", requestRounds+1, "轮请求 ------------\n", msgList);

        const singleRequestTimer = setTimeout(() => {
          singleRequestController.abort(new Error("request_timeout"));
        }, requestTimeoutMs);
        try {
          responseResult = await callLLM(msgList, { signal: requestSignal });
        } finally {
          clearTimeout(singleRequestTimer);
        }

        requestRounds += 1;
      } catch (e) {
        if (requestSignal.aborted) {
          console.log(requestSignal.reason.message);
          stopReason = requestSignal.reason.message;
          errorDetail = {
            kind: "timeout",
            message: requestSignal.reason.message === 'request_timeout' ? `模型请求超过 ${requestTimeoutMs}ms` : requestSignal.reason.message,
            status: null,
          };
          stopFlag = true;
          break;
        } else if (e.cause?.status === 429) {
          if (retryRounds >= maxRetryRounds) {
            console.warn("警告:请求过于频繁且超过最大重试次数");
            stopReason = "retry_exhausted";
            errorDetail = {
              kind: "http",
              message: e.message,
              status: e.cause?.status ?? null
            };
            break;
          }
          // 退避等待
          const delayMs = Math.min(1000 * 2 ** retryRounds, 8000);
          console.warn(`警告:请求过于频繁，${delayMs}ms 后重试`);
          try {
            await sleep(delayMs, requestSignal);
          } catch (e) {
            if (requestSignal.aborted) {
              console.log(requestSignal.reason.message);
              stopReason = requestSignal.reason.message;
              errorDetail = {
                kind: "timeout",
                message: requestSignal.reason.message === 'request_timeout' ? `模型请求超过 ${requestTimeoutMs}ms` : requestSignal.reason.message,
                status: null,
              };
              stopFlag = true;
              break;
            }
            throw e; // 不认识的错误继续向上传播
          }
          retryRounds += 1;
          continue;
        } else if (e.cause?.status === 400) {
          console.warn("警告:请求参数错误，检查输入");
          stopFlag = true;
          stopReason = "http_400";
          errorDetail = {
            kind: "http",
            message: e.message,
            status: e.cause?.status ?? null
          };
          break;
        } else if (e.kind === "network") {
          stopFlag = true;
          stopReason = "network_error";
          errorDetail = {
            kind: e.kind ?? "unknown",
            message: e.message,
            status: e.cause?.status ?? null
          };
          break;
        } else if (e.kind === "http") {
          stopFlag = true;
          stopReason = "http_error";
          errorDetail = {
            kind: e.kind ?? "unknown",
            message: e.message,
            status: e.cause?.status ?? null
          };
          break;
        } else if (e.kind === "response_parse") {
          stopFlag = true;
          stopReason = "response_parse_error";
          errorDetail = {
            kind: e.kind ?? "unknown",
            message: e.message,
            status: e.cause?.status ?? null
          };
          break;
        } else {
          console.error("警告:其他错误:", e);
          stopFlag = true;
          stopReason = "other_error";
          errorDetail = {
            kind: "unknown",
            message: e.message,
            status: e.cause?.status ?? null
          };
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
      } else if (choice.finish_reason === "length") {
        stopReason = "output_limit";
        stopFlag = true;
        break;
      } else if (choice.finish_reason === 'sensitive') {
        stopReason = "sensitive";
        stopFlag = true;
        break;
      } else if (choice.finish_reason === 'model_context_window_exceeded') {
        stopReason = "model_context_window_exceeded";
        stopFlag = true;
        break;
      } else {
        console.warn("警告:返回异常 finish_reason, 停止循环");
        stopFlag = true;
        stopReason = "unexpected_finish_reason";
        stopDetail = {
          finishReason: choice.finish_reason
        };
        break;
      }
    }
  } finally {
    // 清理总任务计时器
    clearTimeout(totalTaskTimer);
  }

  if (verbose) console.log("循环结束, 输入 token:", totalPromptTokens);
  if (verbose) console.log("循环结束, 输出 token:", totalCompletionTokens);
  return { messages: msgList, stopReason, errorDetail, stopDetail, rounds: requestRounds, retries: retryRounds, totalPromptTokens, totalCompletionTokens };
};

export default runLoop;
