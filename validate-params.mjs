export function validateParams(params, toolDefinition) {
  // 把现有的对象检查、必填字段检查、类型检查搬进来
  // 校验失败：返回错误字符串
  // 校验通过：返回 null

  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return "工具调用失败 - 参数必须是 JSON 对象";
  }

  const requiredParams = toolDefinition.function.parameters.required;
  // console.log("requiredParams:", requiredParams);
  const missingParams = requiredParams.filter(p => !Object.hasOwn(params, p));
  if (missingParams.length > 0) {
    console.error("缺少必填参数:", missingParams);
    return "工具调用失败 - 缺少必填参数: " + missingParams.join(", ");
  }

  const properties = toolDefinition.function.parameters.properties;
  let checkTypeResult = [];
  for (const [pKey, pValue] of Object.entries(params)) {
    if (!properties?.[pKey]?.type) continue;
    if (properties[pKey].type !== typeof pValue) {
      console.error("参数类型错误:", pKey + " 应为 " + properties[pKey].type + "，实际为 " + typeof pValue);
      checkTypeResult.push(pKey + " 应为 " + properties[pKey].type);
    }
  }
  if (checkTypeResult.length > 0) {
    return "工具调用失败 - 以下参数类型错误: " + checkTypeResult.join(", ");
  }

  return null;
}