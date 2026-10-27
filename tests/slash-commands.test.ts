import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVAILABLE_COMMANDS,
  availableCommandsUpdate,
  discoverSkills,
  interpretSlashCommand,
  isClientTextSlashPrompt,
  kiroAvailableCommands,
  parseSlashCommand,
  resolveModelValue
} from "../src/acp/slash-commands/index.js";

describe("parseSlashCommand", () => {
  it("parses name and optional input", () => {
    expect(parseSlashCommand("/mode plan")).toEqual({ name: "mode", input: "plan" });
    expect(parseSlashCommand("  /plan  ")).toEqual({ name: "plan", input: "" });
    expect(parseSlashCommand("/model Gemini 3.5 Flash")).toEqual({
      name: "model",
      input: "Gemini 3.5 Flash"
    });
  });

  it("returns null for ordinary prompts", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("/mode plan\nand more")).toBeNull();
    expect(parseSlashCommand("use /mode later")).toBeNull();
  });
});

describe("isClientTextSlashPrompt", () => {
  it("accepts a single non-empty text block", () => {
    expect(isClientTextSlashPrompt([{ type: "text", text: "/plan" }])).toBe(true);
    expect(isClientTextSlashPrompt([{ type: "text", text: "  /mode plan  " }])).toBe(true);
  });

  it("rejects resource, image, or multi-block prompts", () => {
    expect(
      isClientTextSlashPrompt([
        {
          type: "resource",
          resource: { uri: "file:///notes.md", text: "/plan", mimeType: "text/markdown" }
        }
      ])
    ).toBe(false);
    expect(
      isClientTextSlashPrompt([
        { type: "text", text: "/plan" },
        { type: "resource_link", uri: "file:///x.ts", name: "x.ts" }
      ])
    ).toBe(false);
    expect(
      isClientTextSlashPrompt([
        { type: "image", mimeType: "image/png", data: "aa" }
      ])
    ).toBe(false);
  });
});

describe("interpretSlashCommand", () => {
  it("maps plan and mode", () => {
    expect(interpretSlashCommand({ name: "plan", input: "" })).toEqual({
      kind: "set_config",
      configId: "mode",
      value: "plan"
    });
    expect(interpretSlashCommand({ name: "mode", input: "accept-edits" })).toEqual({
      kind: "set_config",
      configId: "mode",
      value: "accept-edits"
    });
    expect(interpretSlashCommand({ name: "mode", input: "accept_edits" })).toEqual({
      kind: "set_config",
      configId: "mode",
      value: "accept-edits"
    });
  });

  it("maps model and effort", () => {
    expect(interpretSlashCommand({ name: "model", input: "gemini-3.5-flash" })).toEqual({
      kind: "set_config",
      configId: "model",
      value: "gemini-3.5-flash"
    });
    expect(interpretSlashCommand({ name: "effort", input: "high" })).toEqual({
      kind: "set_config",
      configId: "reasoningEffort",
      value: "high"
    });
  });

  it("errors on invalid curated usage and passes unknown names", () => {
    expect(interpretSlashCommand({ name: "mode", input: "" }).kind).toBe("error");
    expect(interpretSlashCommand({ name: "mode", input: "turbo" }).kind).toBe("error");
    expect(interpretSlashCommand({ name: "plan", input: "extra" }).kind).toBe("error");
    expect(interpretSlashCommand({ name: "help", input: "" })).toEqual({ kind: "pass" });
    expect(interpretSlashCommand({ name: "skills", input: "" })).toEqual({ kind: "skills" });
  });
});

describe("resolveModelValue", () => {
  const catalog = {
    baseModels: () => ["gemini-3.5-flash", "claude-sonnet-4"],
    displayName: (slug: string) =>
      slug === "gemini-3.5-flash" ? "Gemini 3.5 Flash" : "Claude Sonnet 4",
    slugForAgyBase: (base: string) => (base === "Gemini 3.5 Flash" ? "gemini-3.5-flash" : undefined)
  };

  it("resolves slug, display name, and unique prefix", () => {
    expect(resolveModelValue("gemini-3.5-flash", catalog)).toBe("gemini-3.5-flash");
    expect(resolveModelValue("Gemini 3.5 Flash", catalog)).toBe("gemini-3.5-flash");
    expect(resolveModelValue("claude", catalog)).toBe("claude-sonnet-4");
    expect(resolveModelValue("nope", catalog)).toBeNull();
  });
});

describe("availableCommandsUpdate", () => {
  it("advertises the curated command list", () => {
    const update = availableCommandsUpdate();
    expect(update).toMatchObject({
      sessionUpdate: "available_commands_update",
      availableCommands: AVAILABLE_COMMANDS
    });
    expect(AVAILABLE_COMMANDS.map((c) => c.name).sort()).toEqual(
      ["effort", "mode", "model", "plan", "skills"].sort()
    );
  });
});

describe("discoverSkills and kiroAvailableCommands", () => {
  it("discovers skills from workspace and formats for Kiro/Paseo", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-skills-test-"));
    try {
      const skillDir = path.join(tmpDir, ".agents", "skills", "test-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---\nname: test-skill\ndescription: Test description\n---\n# Test Skill`
      );

      const skills = discoverSkills(tmpDir);
      const found = skills.find((s) => s.name === "test-skill");
      expect(found).toBeDefined();
      expect(found?.description).toBe("Test description");

      const kiro = kiroAvailableCommands(tmpDir);
      expect(kiro.commands.some((c) => c.name === "/mode")).toBe(true);
      expect(kiro.prompts.some((p) => p.name === "test-skill")).toBe(true);

      const update = availableCommandsUpdate(tmpDir);
      if (update.sessionUpdate === "available_commands_update") {
        expect(update.availableCommands.some((c) => c.name === "test-skill")).toBe(true);
      } else {
        throw new Error("expected available_commands_update");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
