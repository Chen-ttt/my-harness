import { readFileTool } from "./read-file.mjs";
import { listDirTool } from "./list-dir.mjs";

export { readFileTool, listDirTool };

// 工具名 + 工具实现
const toolsList = [
  {
    "type": "function",
    "function": {
      "name": "list_dir",
      "description": "列举指定目录下的文件列表",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "目录路径,例如:/home/user" },
        },
        "required": ["path"]
      }
    },
    impl: listDirTool
  },
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "读取指定文件的内容",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "文件路径,例如:/home/user/test.txt" }
        },
        "required": ["path"]
      }
    },
    impl: readFileTool
  }
];

export const tools = toolsList.map((tool) => { return { "type": "function", "function": tool.function }; });
export const toolImpls = toolsList.reduce((acc, tool) => {
  if (Object.hasOwn(acc, tool.function.name)) throw new Error(`Tool ${tool.function.name} already exists`);
  return { ...acc, [tool.function.name]: tool.impl };
 }, {});
