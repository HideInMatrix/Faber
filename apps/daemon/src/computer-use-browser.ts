import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { browserConfiguration } from "@hideinmatrix/computer-use";

/** Accept bare origins entered by users; never broaden paths or credential URLs. */
export function parseComputerUseBrowser(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid browser configuration");
  const raw = Reflect.get(value, "allowedOrigins");
  if (!Array.isArray(raw) || !raw.length || raw.length > 32) throw new Error("允许的网站须为 1-32 个 HTTP(S) origin");
  const allowedOrigins = raw.map(item => {
    if (typeof item !== "string" || item.length > 4096) throw new Error("Invalid browser origin");
    const text = item.trim(), url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || ![url.origin, `${url.origin}/`].includes(text)) throw new Error("允许的网站只能填写 HTTP(S) origin，不能包含路径、参数或凭据");
    return `${url.origin}/`;
  });
  return browserConfiguration.parse({ ...value, allowedOrigins: [...new Set(allowedOrigins)] });
}

// New app-data directories may not exist yet; resolve their existing ancestors
// without creating them. Workspace aliases must not expose the private profile.
function canonicalPath(path: string): string {
  try { return realpathSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return join(canonicalPath(dirname(path)), basename(path));
  }
}

/** Host-owned application data only, never model-controlled userDataDir/profile paths. */
export function computerUseBrowserDataDirectory(workspace: string, platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = platform === "darwin" ? join(home, "Library", "Application Support", "Faber")
    : platform === "win32" ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Faber")
    : join(env.XDG_DATA_HOME || join(home, ".local", "share"), "faber");
  const directory = resolve(base, "computer-use");
  const within = relative(canonicalPath(resolve(workspace)), canonicalPath(directory));
  if (!within || (!within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within))) {
    throw new Error("托管浏览器数据目录不能位于 Workspace 内，请选择更具体的工作目录");
  }
  return directory;
}
