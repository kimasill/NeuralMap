import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { ingestContextPackArtifact } from "./artifact.js";
import { linkCrossSourceReferences } from "./cross-source-linker.js";
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

  it("links ticket mentions to repository file nodes across source systems", () => {
    const repository = ingestRepository({
      id: "fixture",
      root: "/repo",
      files: [
        {
          path: "src/index.ts",
          content: "export const ok = true;\n"
        }
      ]
    });
    const ticket = {
      nodes: [
        {
          id: "ticket:AIN-10",
          type: "Ticket" as const,
          title: "Fix src/index.ts",
          summary: "The issue is in src/index.ts and needs a follow-up.",
          content_ref: "linear://AIN-10",
          source_system: "ticket" as const,
          trust_score: 0.8,
          freshness_score: 0.9,
          importance_score: 0.7,
          created_at: "2026-05-03T00:00:00.000Z",
          updated_at: "2026-05-03T00:00:00.000Z",
          metadata: {}
        }
      ],
      edges: [],
      chunks: []
    };

    const linked = linkCrossSourceReferences(ticket, repository, "2026-05-03T00:00:00.000Z");

    expect(linked.edges).toContainEqual(
      expect.objectContaining({
        from: "ticket:AIN-10",
        to: "repo:fixture:file:src/index.ts",
        type: "references",
        metadata: expect.objectContaining({
          source: "cross_source_linker",
          reason: "path_mention",
          matched_text: "src/index.ts"
        })
      })
    );
  });

  it("links generated artifact evidence to repository file nodes", () => {
    const repository = ingestRepository({
      id: "fixture",
      root: "/repo",
      files: [
        {
          path: "src/index.ts",
          content: "export const ok = true;\n"
        }
      ]
    });
    const artifact = ingestContextPackArtifact({
      id: "ctx_artifact_link",
      objective: "Summarize implementation evidence",
      agent_id: "main-agent",
      session_id: "test-session",
      node_ids: [],
      evidence: [
        {
          node_id: "doc:note",
          snippet: "The implementation evidence points at src/index.ts.",
          score: 0.8
        }
      ],
      decisions: [],
      blockers: [],
      token_budget: 1200,
      metadata: {},
      created_at: "2026-05-03T00:00:00.000Z"
    });

    const linked = linkCrossSourceReferences(artifact, repository, "2026-05-03T00:00:00.000Z");

    expect(linked.nodes).toContainEqual(
      expect.objectContaining({
        id: "artifact:context:ctx_artifact_link",
        type: "Artifact"
      })
    );
    expect(linked.edges).toContainEqual(
      expect.objectContaining({
        from: "artifact:context:ctx_artifact_link",
        to: "repo:fixture:file:src/index.ts",
        type: "references",
        metadata: expect.objectContaining({
          source: "cross_source_linker",
          reason: "path_mention",
          matched_text: "src/index.ts"
        })
      })
    );
  });
});
