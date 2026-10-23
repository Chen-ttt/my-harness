import { readFileTool } from "./read-file.mjs";
import { listDirTool } from "./list-dir.mjs";

export { readFileTool, listDirTool };

// 工具名 → 工具实现；新增工具时需同步 ask.mjs 里的 tools schema
export const toolImpls = {
  list_dir: listDirTool,
  read_file: readFileTool,
};
