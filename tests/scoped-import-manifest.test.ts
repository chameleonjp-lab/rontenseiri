import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject, validateProject } from "../src/domain/project";
import { exportProject, importProject } from "../src/export/project";

async function realExportFixture() {
  const parsed = await parseInputs([
    {
      name: "published-source.txt",
      format: "txt",
      role: "conversation",
      text: "A: selected evidence\nA: outside evidence",
    },
  ]);
  const project = validateProject(
    createProject(parsed, "published-project", "full"),
  );
  const agendaId = project.agendas[0].id;
  const limited = JSON.parse(
    exportProject(project, "json", agendaId, false, ["U01"]),
  ) as {
    scope: string;
    manifest: Record<string, unknown>;
    project: Record<string, any>;
  };
  return { project, agendaId, limited };
}

describe("scoped import manifest boundary", () => {
  it("rejects full scope when a limited manifest is retained and full values are injected", async () => {
    const { project, limited } = await realExportFixture();
    const fullAgenda = project.agendas[0];
    const fullSource = project.sources[0];

    // Change only the scope discriminator; deliberately retain the published limited manifest.
    limited.scope = "full";
    // These are valid values from the same full project, but outside the selected U01 scope.
    limited.project.sources[0].text = fullSource.text;
    limited.project.sources[0].name = fullSource.name;
    limited.project.agendas[0].arrival = fullAgenda.arrival;
    limited.project.agendas[0].decision = fullAgenda.decision;
    limited.project.agendas[0].answer = fullAgenda.answer;
    limited.project.agendas[0].agreement = fullAgenda.agreement;
    limited.project.agendas[0].verification = fullAgenda.verification;
    limited.project.agendas[0].unresolved = [...fullAgenda.unresolved];
    limited.project.agendas[0].nextAction = fullAgenda.nextAction;
    limited.project.agendas[0].needsReview = fullAgenda.needsReview;

    expect(() => importProject(JSON.stringify(limited))).toThrow();
  });

  it.each([
    ["limited", true],
    ["fullBackup", false],
    ["historyIncluded", false],
    ["sourceCoverageComplete", true],
    ["organizationComplete", true],
  ])(
    "rejects full scope with contradictory manifest field: %s",
    async (field, value) => {
      const { project } = await realExportFixture();
      const full = JSON.parse(exportProject(project, "json")) as {
        manifest: Record<string, unknown>;
      };
      full.manifest[field] =
        field === "sourceCoverageComplete"
          ? !full.manifest.sourceCoverageComplete
          : value;
      expect(() => importProject(JSON.stringify(full))).toThrow();
    },
  );

  it("accepts the canonical full manifest and a legacy full wrapper without one", async () => {
    const { project } = await realExportFixture();
    const full = exportProject(project, "json");
    expect(importProject(full).utterances.map((u) => u.id)).toEqual([
      "U01",
      "U02",
    ]);
    const legacy = JSON.parse(full) as Record<string, unknown>;
    delete legacy.manifest;
    expect(importProject(JSON.stringify(legacy)).utterances).toHaveLength(2);
  });

  it("accepts and restores a legitimate limited export without leaking omitted values", async () => {
    const { limited } = await realExportFixture();
    const restored = importProject(JSON.stringify(limited));
    expect(restored.utterances.map((u) => u.id)).toEqual(["U01"]);
    expect(restored.sources[0].text).toBe("A: selected evidence");
    expect(restored.agendas[0].arrival).toContain("限定出力");
    expect(JSON.stringify(restored)).not.toContain("outside evidence");
  });

  it("accepts a legitimate full export and preserves its full source and agenda values", async () => {
    const { project } = await realExportFixture();
    const restored = importProject(exportProject(project, "json"));
    expect(restored.sources[0].text).toBe(project.sources[0].text);
    expect(restored.utterances.map((u) => u.id)).toEqual(["U01", "U02"]);
    expect(restored.agendas[0]).toMatchObject({
      arrival: project.agendas[0].arrival,
      decision: project.agendas[0].decision,
      answer: project.agendas[0].answer,
      agreement: project.agendas[0].agreement,
      verification: project.agendas[0].verification,
      unresolved: project.agendas[0].unresolved,
      nextAction: project.agendas[0].nextAction,
      needsReview: project.agendas[0].needsReview,
    });
  });

  it("roundtrips a legitimate limited export through parse, import, and re-export", async () => {
    const { limited } = await realExportFixture();
    const restored = importProject(JSON.stringify(limited));
    const reexported = JSON.parse(
      exportProject(restored, "json", restored.agendas[0].id, false, ["U01"]),
    );
    expect(reexported.scope).toBe("agenda");
    expect(reexported.manifest.allowedUtteranceIds).toEqual(["U01"]);
    expect(
      reexported.project.utterances.map((u: { id: string }) => u.id),
    ).toEqual(["U01"]);
  });
});
