import assert from "node:assert/strict";
import { validateParams } from "./validate-params.mjs";

const toolDefinition = {
    "type": "function",
    "function": {
        "name": "list_dir",
        "description": "列举指定目录下的文件列表",
        "parameters": {
            "type": "object",
            "properties": {
                "value": { "type": "string", "description": "test" },
            },
            "required": ["value"]
        }
    }
};

assert.ok(validateParams({}, toolDefinition).includes("缺少必填参数"));
assert.ok(validateParams({ value: 123 }, toolDefinition).includes("参数类型错误"));
assert.ok(validateParams({ value: false }, toolDefinition).includes("参数类型错误"));
assert.ok(validateParams({ value: null }, toolDefinition).includes("参数类型错误"));
assert.equal(validateParams({ value: "" }, toolDefinition), null);
assert.equal(validateParams({ value: "." }, toolDefinition), null);
for (const params of [null, [], 123]) {
  assert.equal(
    validateParams(params, toolDefinition),
    "工具调用失败 - 参数必须是 JSON 对象"
  );
}

console.log("9 条用例通过");