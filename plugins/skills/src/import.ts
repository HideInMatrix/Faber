import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { loadSkills, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { SkillSourceConfig } from "@micromatrix/plugin-kit";

export interface SkillImportPreview {
  readonly path: string;
  readonly candidates: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly path: string;
    readonly status: "new" | "existing" | "conflict";
    readonly warnings: readonly string[];
  }[];
  readonly diagnostics: readonly { path: string; message: string }[];
}

function sourceId(folder: string, used: Set<string>): string {
  let base = folder.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
  if (!/^[a-z]/.test(base)) base = `skill-${base}`;
  base = base.slice(0, 64).replace(/-+$/g, "");
  let id = base;
  for (let index = 2; used.has(id); index++) {
    const suffix = `-${index}`;
    id = base.slice(0, 64 - suffix.length) + suffix;
  }
  used.add(id);
  return id;
}

/** Read-only discovery. Explicit paths only; never install, copy or execute skills. */
export async function previewSkillImport(path: string, workspace: string, sources: readonly SkillSourceConfig[], replaceSourceId?: string): Promise<SkillImportPreview> {
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("Skill import path must be absolute");
  const canonicalRoot = await realpath(path);
  const replaced = replaceSourceId === undefined ? undefined : sources.find(source => source.id === replaceSourceId);
  if (replaceSourceId !== undefined && (!replaced || await realpath(replaced.path) !== canonicalRoot)) throw new Error("Skill source changed; scan the directory again");
  const remaining = sources.filter(source => source.id !== replaceSourceId);
  const knownFiles = new Set<string>(), knownNames = new Set<string>();
  // Include disabled sources: reimport must not silently re-enable them or make
  // a future toggle ambiguous. Overlapping legacy directory sources count too.
  for (const source of remaining) {
    const existing = loadSkills({ cwd: workspace, agentDir: workspace, skillPaths: [source.path], includeDefaults: false });
    for (const skill of existing.skills) {
      knownFiles.add(await realpath(skill.filePath));
      knownNames.add(skill.name);
    }
  }
  const info = await stat(canonicalRoot);
  const result = info.isDirectory()
    ? loadSkillsFromDir({ dir: canonicalRoot, source: "path" })
    : loadSkills({ cwd: workspace, agentDir: workspace, skillPaths: [canonicalRoot], includeDefaults: false });
  if (result.skills.length > 1000) throw new Error("Too many discovered Skills (max 1000); choose a smaller directory");
  const candidates: Array<SkillImportPreview["candidates"][number]> = [];
  const used = new Set(remaining.map(source => source.id));
  const seenFiles = new Set<string>(), seenNames = new Set<string>();
  for (const skill of [...result.skills].sort((a, b) => a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0)) {
    const file = await realpath(skill.filePath);
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    // Use a canonical single-file reference so later-added nested documents
    // cannot bypass an individual Skill's on/off switch.
    const canonical = loadSkills({ cwd: workspace, agentDir: workspace, skillPaths: [file], includeDefaults: false });
    const loaded = canonical.skills[0];
    if (!loaded) continue;
    const status = knownFiles.has(file) ? "existing"
      : knownNames.has(loaded.name) || seenNames.has(loaded.name) ? "conflict" : "new";
    seenNames.add(loaded.name);
    candidates.push({ id: sourceId(basename(dirname(skill.filePath)), used), name: loaded.name,
      description: loaded.description, path: file, status, warnings: canonical.diagnostics.map(item => item.message) });
  }
  return { path: canonicalRoot, candidates, diagnostics: result.diagnostics.map(item => ({ path: item.path ?? canonicalRoot, message: item.message })) };
}

/** Re-scan at commit time. A changed/missing/conflicting selection fails atomically. */
export async function planSkillImport(path: string, selectedPaths: readonly string[], workspace: string, sources: readonly SkillSourceConfig[], replaceSourceId?: string): Promise<readonly SkillSourceConfig[]> {
  if (!Array.isArray(selectedPaths) || !selectedPaths.length || selectedPaths.length > 100
    || selectedPaths.some(item => typeof item !== "string") || new Set(selectedPaths).size !== selectedPaths.length) throw new Error("Select 1-100 distinct Skill documents");
  const preview = await previewSkillImport(path, workspace, sources, replaceSourceId);
  const selected = selectedPaths.map(file => {
    const candidate = preview.candidates.find(item => item.path === file && item.status === "new");
    if (!candidate) throw new Error("Selected Skill changed, is already configured or has a name conflict; scan again");
    return candidate;
  });
  const enabled = sources.find(source => source.id === replaceSourceId)?.enabled ?? true;
  const next = [...sources.filter(source => source.id !== replaceSourceId), ...selected.map(({ id, path }) => ({ id, path, enabled }))];
  if (next.length > 100) throw new Error("Too many Skill sources (max 100); select fewer documents");
  return next;
}
