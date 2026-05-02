import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { ingestRepository } from "./repository.js";
import { scanRepositorySnapshot } from "./repo-scanner.js";

describe("repository ingest", () => {
  it("emits file nodes, chunks, and local import dependency edges", () => {
    const emission = ingestRepository({
      id: "fixture",
      root: "/repo",
      files: [
        {
          path: "src/index.ts",
          content: 'import { helper } from "./helper";\nexport const value = helper();\n',
          language: "typescript"
        },
        {
          path: "src/helper.ts",
          content: "export function helper() { return 1; }\n",
          language: "typescript"
        }
      ]
    });

    expect(emission.nodes.map((node) => node.id)).toContain("repo:fixture:file:src/index.ts");
    expect(emission.chunks.length).toBeGreaterThanOrEqual(2);
    expect(emission.edges).toContainEqual(
      expect.objectContaining({
        from: "repo:fixture:file:src/index.ts",
        to: "repo:fixture:file:src/helper.ts",
        type: "depends_on"
      })
    );
  });

  it("scans text-like repository files and ignores generated folders", async () => {
    const root = join(tmpdir(), `neuralmap-ingest-${Date.now()}`);
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export const ok = true;\n");
    await writeFile(join(root, "README.md"), "# Fixture\n");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored\n");

    const snapshot = await scanRepositorySnapshot({
      root,
      id: "scan-fixture"
    });

    expect(snapshot.files.map((file) => file.path).sort()).toEqual(["README.md", "src/index.ts"]);
  });
});

