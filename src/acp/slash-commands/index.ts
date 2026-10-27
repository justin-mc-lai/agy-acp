// ACP Slash Commands: curated available_commands_update + prompt intercept for agy-acp.
// Docs: https://agentclientprotocol.com/protocol/v1/slash-commands
//
// ACP only needs name + description (and optional unstructured input hint).
// Clients send selected commands as normal session/prompt text like `/mode plan`.
//
// We advertise only commands this wrapper can honor without agy's TUI panels:
// session config surfaces already mapped to `agy --mode` / `--model` / `--effort`.
// Full TUI palette (/settings, /mcp, /help overlays, …) is intentionally omitted.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AvailableCommand, ContentBlock, SessionUpdate } from "@agentclientprotocol/sdk";

export const MODE_SLASH = "mode";
export const PLAN_SLASH = "plan";
export const MODEL_SLASH = "model";
export const EFFORT_SLASH = "effort";
export const SKILLS_SLASH = "skills";

/** Commands advertised to clients for typeahead / slash menus. */
export const AVAILABLE_COMMANDS: readonly AvailableCommand[] = [
  {
    name: MODE_SLASH,
    description: "Set agy execution mode for this session (default, accept-edits, plan).",
    input: { hint: "default | accept-edits | plan" }
  },
  {
    name: PLAN_SLASH,
    description: "Switch to plan mode (agy --mode plan)."
  },
  {
    name: MODEL_SLASH,
    description: "Switch the model used for this session (agy --model).",
    input: { hint: "model slug or name" }
  },
  {
    name: EFFORT_SLASH,
    description: "Set reasoning effort for the current model (agy --effort).",
    input: { hint: "low | medium | high" }
  },
  {
    name: SKILLS_SLASH,
    description: "List skills discovered by agy for this session."
  }
];

function parseSkillMd(filePath: string, fallbackName: string): (AvailableCommand & { kind?: string }) | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match) return null;
    const yaml = match[1];
    let name = fallbackName;
    const nameMatch = /^name:\s*(.+)$/m.exec(yaml);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }
    let description = "";
    const descMatch = /^description:\s*(?:[>|]\s*)?([\s\S]*?)(?=\n[a-zA-Z0-9_-]+:|$)/m.exec(yaml);
    if (descMatch) {
      description = descMatch[1].replace(/\r?\n\s*/g, " ").trim().replace(/^["']|["']$/g, "");
    }
    let hint = "arguments";
    const hintMatch = /^(?:argument-hint|hint):\s*(.+)$/m.exec(yaml);
    if (hintMatch) {
      hint = hintMatch[1].trim().replace(/^["']|["']$/g, "");
    }
    return {
      name,
      description: description || `Skill: ${name}`,
      input: { hint }
    };
  } catch {
    return null;
  }
}

function scanSkillDir(skillsDir: string, map: Map<string, AvailableCommand>): void {
  if (!fs.existsSync(skillsDir)) return;
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(skillsDir, ent.name);
      let isDir = ent.isDirectory();
      if (!isDir && ent.isSymbolicLink()) {
        try {
          isDir = fs.statSync(fullPath).isDirectory();
        } catch {}
      }
      if (isDir) {
        const skillMd = path.join(fullPath, "SKILL.md");
        if (fs.existsSync(skillMd)) {
          const parsed = parseSkillMd(skillMd, ent.name);
          if (parsed && !map.has(parsed.name)) {
            map.set(parsed.name, parsed);
          }
        }
      } else if (ent.isFile() && ent.name === "SKILL.md") {
        const dirName = path.basename(skillsDir);
        const parsed = parseSkillMd(fullPath, dirName);
        if (parsed && !map.has(parsed.name)) {
          map.set(parsed.name, parsed);
        }
      }
    }
  } catch {}
}

const skillCache = new Map<string, { timestamp: number; skills: AvailableCommand[] }>();
const CACHE_TTL_MS = 20000;

export function discoverSkills(
  cwd: string = process.cwd(),
  additionalDirectories: string[] = []
): AvailableCommand[] {
  const normCwd = path.resolve(cwd || process.cwd());
  const normAdditional = (additionalDirectories || []).map((d) => path.resolve(d));
  const cacheKey = `${normCwd}:${normAdditional.join(";")}`;
  const cached = skillCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.skills;
  }

  const map = new Map<string, AvailableCommand>();
  const home = os.homedir();

  const workspaceDirs = [
    path.join(normCwd, ".agents", "skills"),
    path.join(normCwd, ".gemini", "skills"),
    path.join(normCwd, "skills")
  ];
  for (const extra of normAdditional) {
    workspaceDirs.push(
      path.join(extra, ".agents", "skills"),
      path.join(extra, ".gemini", "skills"),
      path.join(extra, "skills")
    );
  }
  for (const d of workspaceDirs) {
    scanSkillDir(d, map);
  }

  const globalDirs = [
    path.join(home, ".gemini", "config", "skills"),
    path.join(home, ".gemini", "antigravity", "builtin", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".gemini", "skills")
  ];
  for (const d of globalDirs) {
    scanSkillDir(d, map);
  }

  const pluginsDir = path.join(home, ".gemini", "config", "plugins");
  if (fs.existsSync(pluginsDir)) {
    try {
      const plugins = fs.readdirSync(pluginsDir);
      for (const p of plugins) {
        const sDir = path.join(pluginsDir, p, "skills");
        if (fs.existsSync(sDir)) {
          scanSkillDir(sDir, map);
        }
      }
    } catch {}
  }

  const skills = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  skillCache.set(cacheKey, { timestamp: now, skills });
  return skills;
}

// Pre-warm skill cache on process startup
setTimeout(() => {
  try {
    discoverSkills();
  } catch {}
}, 0);

/** ACP session update listing the curated command set and discovered skills. */
export function availableCommandsUpdate(cwd?: string, additionalDirectories?: string[]): SessionUpdate {
  const skills = cwd ? discoverSkills(cwd, additionalDirectories) : [];
  const reserved = new Set(AVAILABLE_COMMANDS.map((c) => c.name));
  const skillCommands: AvailableCommand[] = skills
    .filter((s) => !reserved.has(s.name))
    .map((s) => ({
      name: s.name,
      description: s.description,
      input: s.input,
      kind: "skill",
      _meta: { kind: "skill" }
    }));
  return {
    sessionUpdate: "available_commands_update",
    availableCommands: [
      ...AVAILABLE_COMMANDS.map((c) => ({ ...c, kind: "command" })),
      ...skillCommands
    ]
  };
}

/** Formats commands and skills for Paseo/Kiro _kiro.dev/commands/available extension notification. */
export function kiroAvailableCommands(
  cwd?: string,
  additionalDirectories?: string[]
): {
  commands: Array<{ name: string; description: string; meta: { hint: string } }>;
  prompts: Array<{ name: string; description: string; serverName: string; meta: { hint: string } }>;
} {
  const skills = discoverSkills(cwd, additionalDirectories);
  const reserved = new Set(AVAILABLE_COMMANDS.map((c) => c.name));
  return {
    commands: AVAILABLE_COMMANDS.map((c) => ({
      name: "/" + c.name,
      description: c.description,
      meta: { hint: c.input?.hint || "" }
    })),
    prompts: skills
      .filter((s) => !reserved.has(s.name))
      .map((s) => ({
        name: s.name,
        description: s.description,
        serverName: "skill:" + s.name,
        meta: { hint: s.input?.hint || "" }
      }))
  };
}

export type ParsedSlashCommand = {
  name: string;
  /** Remainder after the command name; empty string when omitted. */
  input: string;
};

/**
 * Parse a prompt that is only a single slash command (optional free-text input).
 * Returns null when the text is not a pure slash invocation (mixed content,
 * attachments already flattened into non-slash text, multi-command, etc.).
 */
export function parseSlashCommand(promptText: string): ParsedSlashCommand | null {
  const trimmed = promptText.trim();
  // Single-line only: multi-line prompts are treated as ordinary user text.
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  const match = /^\/([A-Za-z][\w-]*)(?:\s+(\S[\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    input: (match[2] ?? "").trim()
  };
}

/**
 * True when the client's original ContentBlocks are a pure text slash command
 * (exactly one non-empty text block, no images/resources/links).
 *
 * Slash interception must not fire on flattened resource bodies that merely
 * contain text like `/plan` — those should be forwarded to agy as normal
 * prompt content.
 */
export function isClientTextSlashPrompt(blocks: ContentBlock[]): boolean {
  let textBlock: Extract<ContentBlock, { type: "text" }> | undefined;
  for (const block of blocks) {
    if (block.type === "text") {
      if (block.text.trim().length === 0) continue;
      if (textBlock) return false;
      textBlock = block;
      continue;
    }
    // Any non-text block means this is not a client slash-menu selection.
    return false;
  }
  return textBlock !== undefined;
}

export type SlashConfigAction = {
  kind: "set_config";
  configId: "mode" | "model" | "reasoningEffort";
  value: string;
};

export type SlashInterpretResult =
  | { kind: "pass" }
  | { kind: "error"; message: string }
  | { kind: "skills" }
  | SlashConfigAction;

/**
 * Map a parsed slash command onto an ACP config change, or pass through to agy.
 * Model value resolution (slug / display name) is done by the caller with the
 * live catalog — this only validates structure for mode/effort and packages
 * the raw model input.
 */
export function interpretSlashCommand(parsed: ParsedSlashCommand): SlashInterpretResult {
  switch (parsed.name) {
    case PLAN_SLASH:
      if (parsed.input) {
        return { kind: "error", message: "/plan does not take arguments; use /mode plan or omit the input." };
      }
      return { kind: "set_config", configId: "mode", value: "plan" };

    case SKILLS_SLASH:
      return { kind: "skills" };

    case MODE_SLASH: {
      if (!parsed.input) {
        return {
          kind: "error",
          message: "Usage: /mode default | accept-edits | plan"
        };
      }
      const value = normalizeModeInput(parsed.input);
      if (!value) {
        return {
          kind: "error",
          message: `Unknown mode "${parsed.input}". Use: default | accept-edits | plan`
        };
      }
      return { kind: "set_config", configId: "mode", value };
    }

    case MODEL_SLASH: {
      if (!parsed.input) {
        return { kind: "error", message: "Usage: /model <slug or name>" };
      }
      return { kind: "set_config", configId: "model", value: parsed.input };
    }

    case EFFORT_SLASH: {
      if (!parsed.input) {
        return { kind: "error", message: "Usage: /effort low | medium | high" };
      }
      const value = normalizeEffortInput(parsed.input);
      if (!value) {
        return {
          kind: "error",
          message: `Unknown effort "${parsed.input}". Use: low | medium | high`
        };
      }
      return { kind: "set_config", configId: "reasoningEffort", value };
    }

    default:
      // Not in our curated set — leave as ordinary prompt text for agy.
      return { kind: "pass" };
  }
}

function normalizeModeInput(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/_/g, "-");
  if (key === "default" || key === "accept-edits" || key === "plan") return key;
  // Common aliases
  if (key === "acceptedits" || key === "accept" || key === "auto") return "accept-edits";
  if (key === "planning") return "plan";
  return null;
}

function normalizeEffortInput(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key === "low" || key === "medium" || key === "high" || key === "none") return key;
  if (key === "med") return "medium";
  return null;
}

/**
 * Resolve a free-text model request against the session catalog.
 * Accepts ACP base slug, display name, or legacy agy base name (case-insensitive).
 */
export function resolveModelValue(
  raw: string,
  catalog: {
    baseModels(): string[];
    displayName(slug: string): string;
    slugForAgyBase?(agyBase: string): string | undefined;
  }
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const bases = catalog.baseModels();
  if (bases.includes(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  for (const slug of bases) {
    if (slug.toLowerCase() === lower) return slug;
    if (catalog.displayName(slug).toLowerCase() === lower) return slug;
  }

  const fromLegacy = catalog.slugForAgyBase?.(trimmed);
  if (fromLegacy && bases.includes(fromLegacy)) return fromLegacy;

  // Prefix / contains match when unique
  const prefix = bases.filter(
    (slug) =>
      slug.toLowerCase().startsWith(lower) ||
      catalog.displayName(slug).toLowerCase().startsWith(lower)
  );
  if (prefix.length === 1) return prefix[0];

  return null;
}
