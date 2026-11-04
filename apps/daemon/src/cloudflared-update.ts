import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { CloudflaredStatus } from "@micromatrix/control-plane";
import { defaultCloudflaredExecutable } from "./tunnel-executable.js";

const execute = promisify(execFile);
const RELEASE_API = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
const VERSION = /^\d{4}\.\d{1,2}\.\d+$/;
const MAX_ASSET_SIZE = 128 * 1024 * 1024;
const ASSETS: Readonly<Record<string, string>> = {
  "darwin-arm64": "cloudflared-darwin-arm64.tgz",
  "darwin-x64": "cloudflared-darwin-amd64.tgz",
  "win32-x64": "cloudflared-windows-amd64.exe",
};
const DOWNLOAD_HOSTS = new Set(["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
interface ReleaseAsset { version: string; name: string; sha256: string; size: number; url: string }
interface Installation { version: string; directory: string }

export function newerCloudflaredVersion(candidate: string, current: string): boolean {
  if (!VERSION.test(candidate) || !VERSION.test(current)) return false;
  const left = candidate.split(".").map(Number), right = current.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index]! > right[index]!;
  }
  return false;
}

/** Release metadata is fetched directly from Cloudflare's GitHub repository.
 * Never accept an executable URL, checksum or installation path from the UI. */
export function cloudflaredRelease(value: unknown, target: string): ReleaseAsset {
  if (!value || typeof value !== "object") throw new Error("Cloudflare 版本信息格式无效");
  const version: unknown = Reflect.get(value, "tag_name");
  const assets: unknown = Reflect.get(value, "assets");
  if (typeof version !== "string" || !VERSION.test(version) || Reflect.get(value, "draft") !== false
    || Reflect.get(value, "prerelease") !== false || !Array.isArray(assets)) throw new Error("Cloudflare 未返回有效的正式版本");
  const name = ASSETS[target];
  if (!name) throw new Error("当前平台不支持独立更新 cloudflared");
  const asset: unknown = assets.find((entry: unknown) => entry && typeof entry === "object" && Reflect.get(entry, "name") === name);
  if (!asset || typeof asset !== "object") throw new Error("Cloudflare 正式版缺少当前平台的安装文件");
  const digest: unknown = Reflect.get(asset, "digest"), size: unknown = Reflect.get(asset, "size");
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${version}/${name}`;
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)
    || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET_SIZE
    || Reflect.get(asset, "browser_download_url") !== url) throw new Error("Cloudflare 安装文件缺少有效的官方 SHA-256 校验信息");
  return { version, name, sha256: digest.slice(7), size, url };
}

async function download(url: string, maximum: number, signal: AbortSignal, fetcher: typeof fetch): Promise<Buffer> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const target = new URL(url);
    if (target.protocol !== "https:" || !DOWNLOAD_HOSTS.has(target.hostname) || target.username || target.password
      || target.port) throw new Error("cloudflared 更新地址不属于官方 HTTPS 下载源");
    const response = await fetcher(url, { signal, redirect: "manual", headers: {
      "user-agent": "Faber-cloudflared-updater", "accept": "application/octet-stream, application/json",
    } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Cloudflare 下载重定向缺少地址");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Cloudflare 更新请求失败：HTTP ${response.status}`); }
    if (Number(response.headers.get("content-length")) > maximum) {
      await response.body?.cancel(); throw new Error("cloudflared 下载文件超出大小限制");
    }
    if (!response.body) throw new Error("cloudflared 下载响应为空");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) throw new Error("cloudflared 下载文件超出大小限制");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks, size);
  }
  throw new Error("Cloudflare 下载重定向次数过多");
}

export class CloudflaredUpdater {
  readonly #root: string;
  readonly #target: string;
  readonly #fetch: typeof fetch;
  readonly #bundled: string;
  readonly #platform: NodeJS.Platform;
  #latest: ReleaseAsset | undefined;
  #phase: CloudflaredStatus["phase"] = "idle";
  #checkedAt = 0;
  #error = "";
  #versions = new Map<string, Promise<string>>();
  #bundledVersion = "";

  constructor(configFile: string, options: { fetch?: typeof fetch; platform?: NodeJS.Platform; arch?: string; bundledExecutable?: string } = {}) {
    this.#root = join(dirname(configFile), "components", "cloudflared");
    this.#platform = options.platform ?? process.platform;
    this.#target = `${this.#platform}-${options.arch ?? process.arch}`;
    this.#fetch = options.fetch ?? fetch;
    this.#bundled = options.bundledExecutable ?? defaultCloudflaredExecutable();
  }

  #active(): Installation | undefined {
    let data: unknown;
    try { data = JSON.parse(readFileSync(join(this.#root, "active.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw new Error("cloudflared 更新记录损坏，请重新检查并安装更新", { cause: error }); }
    if (!data || typeof data !== "object") throw new Error("cloudflared 更新记录无效");
    const version: unknown = Reflect.get(data, "version"), directory: unknown = Reflect.get(data, "directory");
    if (typeof version !== "string" || !VERSION.test(version) || typeof directory !== "string"
      || !/^[\d.]+-[a-f0-9-]{36}$/.test(directory) || !directory.startsWith(`${version}-`)) throw new Error("cloudflared 更新记录无效");
    if (!existsSync(join(this.#root, directory, this.#binaryName))) throw new Error("cloudflared 更新文件丢失，请重新安装更新");
    return { version, directory };
  }

  get #binaryName(): string { return this.#platform === "win32" ? "cloudflared.exe" : "cloudflared"; }
  executable(custom = ""): string {
    if (custom) return custom;
    const active = this.#active();
    return active && (!this.#bundledVersion || newerCloudflaredVersion(active.version, this.#bundledVersion))
      ? join(this.#root, active.directory, this.#binaryName) : this.#bundled;
  }

  async refresh(): Promise<void> {
    try { this.#bundledVersion = await this.#version(this.#bundled); }
    catch { this.#bundledVersion = ""; } // An installed update can repair a missing bundled binary.
  }

  async #version(executable: string): Promise<string> {
    let pending = this.#versions.get(executable);
    if (!pending) {
      pending = execute(executable, ["--version"], { timeout: 10_000, windowsHide: true, maxBuffer: 4096 }).then(({ stdout }) => {
        const version = /\bcloudflared version (\d{4}\.\d{1,2}\.\d+)\b/.exec(stdout)?.[1];
        if (!version) throw new Error("无法识别 cloudflared 版本");
        return version;
      });
      this.#versions.set(executable, pending);
      void pending.catch(() => this.#versions.delete(executable));
    }
    return pending;
  }

  async status(custom = ""): Promise<CloudflaredStatus> {
    await this.refresh();
    let executable = this.#bundled, version = "", localError = "";
    let source: CloudflaredStatus["source"] = custom ? "custom" : "bundled";
    try {
      executable = this.executable(custom);
      if (!custom && executable !== this.#bundled) source = "updated";
      version = await this.#version(executable);
    } catch (error) { localError = `无法读取 cloudflared：${error instanceof Error ? error.message : String(error)}`; }
    const supported = Boolean(ASSETS[this.#target]) && !custom;
    return { version, source, executable, supported, runtimeBusy: false, phase: this.#phase,
      latestVersion: this.#latest?.version ?? "", checkedAt: this.#checkedAt,
      updateAvailable: supported && Boolean(this.#latest && (!version || newerCloudflaredVersion(this.#latest.version, version))),
      error: this.#error || localError };
  }

  async #release(): Promise<ReleaseAsset> {
    const bytes = await download(RELEASE_API, 2 * 1024 * 1024, AbortSignal.timeout(20_000), this.#fetch);
    return cloudflaredRelease(JSON.parse(bytes.toString("utf8")), this.#target);
  }

  #begin(phase: "checking" | "updating", custom: string): void {
    if (this.#phase !== "idle") throw new Error("cloudflared 更新任务正在进行，请稍后重试");
    if (custom) throw new Error("当前使用自定义隧道程序，请自行更新该程序，或移除自定义路径后更新内置组件");
    if (!ASSETS[this.#target]) throw new Error("当前平台不支持独立更新 cloudflared");
    this.#phase = phase;
    this.#error = "";
  }

  async check(custom = ""): Promise<CloudflaredStatus> {
    this.#begin("checking", custom);
    this.#latest = undefined;
    try { this.#latest = await this.#release(); this.#checkedAt = Date.now(); }
    catch (error) { this.#fail(error); }
    finally { this.#phase = "idle"; }
    return this.status(custom);
  }

  #fail(error: unknown): never {
    this.#error = `cloudflared 更新失败：${error instanceof Error ? error.message : String(error)}。请检查 GitHub 网络连接后重试；原有组件保持不变。`;
    throw new Error(this.#error, { cause: error });
  }

  async install(expectedVersion: string, custom = ""): Promise<CloudflaredStatus> {
    if (!VERSION.test(expectedVersion)) throw new Error("请先检查 cloudflared 更新");
    this.#begin("updating", custom);
    let temporary: string | undefined, destination: string | undefined;
    let activated = false;
    const pointer = join(this.#root, `active-${randomUUID()}.tmp`);
    try {
      const asset = await this.#release();
      this.#latest = asset; this.#checkedAt = Date.now();
      if (asset.version !== expectedVersion) throw new Error("Cloudflare 最新版本已变化，请重新检查后更新");
      const current = await this.status();
      if (current.version && !newerCloudflaredVersion(asset.version, current.version)) return { ...current, phase: "idle" };
      const bytes = await download(asset.url, asset.size, AbortSignal.timeout(180_000), this.#fetch);
      if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("安装文件 SHA-256 或大小校验失败，已拒绝安装");
      await mkdir(this.#root, { recursive: true, mode: 0o700 });
      temporary = await mkdtemp(join(this.#root, ".pending-"));
      const binary = join(temporary, this.#binaryName);
      if (asset.name.endsWith(".tgz")) {
        const archive = join(temporary, "download.tgz");
        await writeFile(archive, bytes, { mode: 0o600 });
        // Verified official archive; extract only the exact binary, never arbitrary paths.
        await execute("/usr/bin/tar", ["-xzf", archive, "-C", temporary, "cloudflared"], { timeout: 30_000, maxBuffer: 4096 });
        await rm(archive);
      } else await writeFile(binary, bytes, { mode: 0o700 });
      const info = await lstat(binary);
      if (!info.isFile() || info.size === 0 || info.size > MAX_ASSET_SIZE) throw new Error("cloudflared 安装文件无效");
      await chmod(binary, 0o700);
      if (await this.#version(binary) !== asset.version) throw new Error("cloudflared 可执行文件版本与官方发布不符");
      const directory = `${asset.version}-${randomUUID()}`;
      destination = join(this.#root, directory);
      await rename(temporary, destination); temporary = undefined;
      await writeFile(pointer, `${JSON.stringify({ version: asset.version, directory })}\n`, { mode: 0o600 });
      // Switch a tiny pointer atomically; never overwrite an executing binary or the signed app bundle.
      await rename(pointer, join(this.#root, "active.json"));
      activated = true;
      this.#versions.clear();
    } catch (error) { this.#fail(error); }
    finally {
      this.#phase = "idle";
      await rm(pointer, { force: true });
      if (temporary) await rm(temporary, { recursive: true, force: true });
      if (destination && !activated) await rm(destination, { recursive: true, force: true });
    }
    return this.status();
  }
}
