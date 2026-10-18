import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("preserves the failed 472926d push run without replacing it with later success", () => {
  const root = new URL(
    "../docs/evaluation/evidence/472926d-push/",
    import.meta.url,
  );
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", root), "utf8"),
  );
  const expected = {
    "browser-evidence.zip": {
      bytes: 2098424,
      sha256:
        "d4827eb9f7686815d107904a896de8c0394192257dd4126d097b8561318a0fe5",
    },
    "github-artifacts.json": {
      bytes: 756,
      sha256:
        "44e1ac2afaa017e63d581325eb7d9a03d425c8b899d3c8b4fef18fba5b08bd8e",
    },
    "run.log": {
      bytes: 77288,
      sha256:
        "a49ede48f8d87391e80e3b6e9f0d309dfbc5cf944edcfdad43f13ee620257f3f",
    },
  };
  expect(manifest.files).toEqual(expected);
  for (const [name, evidence] of Object.entries(expected)) {
    const bytes = readFileSync(new URL(name, root));
    expect(bytes.byteLength).toBe(evidence.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      evidence.sha256,
    );
  }
  expect(manifest).toMatchObject({
    testedSha: "472926d556a21886b6bb3e0c2cd1c373b180150c",
    runId: 39097958704,
    event: "push",
    conclusion: "failure",
    failingStage: "Browser acceptance tests",
    functional: { passed: 48, failed: 1, skipped: 1, didNotRun: 3 },
    archiveDigestVerified: true,
    githubArtifactDigest: `sha256:${expected["browser-evidence.zip"].sha256}`,
  });
});
