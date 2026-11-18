import { access, lstat, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

async function ensureProjectDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`项目数据路径 ${path} 必须是实际目录。请移开同名文件或链接后重试。`);
  }
  await access(path, constants.W_OK);
}

export async function prepareProjectData(workspace: string): Promise<{ root: string; pi: string }> {
  const root = join(await realpath(workspace), ".faber");
  const pi = join(root, "pi");
  try {
    await ensureProjectDirectory(root);
    await ensureProjectDirectory(pi);
    return { root, pi };
  } catch (error) {
    if (["EACCES", "EPERM", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw new Error(`无法写入项目数据目录 ${root}。请检查项目目录和 .faber 的写入权限，或选择可写的工作目录。`, { cause: error });
    }
    throw error;
  }
}
