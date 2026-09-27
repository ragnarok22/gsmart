import type { PlannedCommit } from "../src/utils/split-plan.ts";

export const featureDiff = `diff --git a/src/retry.ts b/src/retry.ts
index 1111111..2222222 100644
--- a/src/retry.ts
+++ b/src/retry.ts
@@ -1,2 +1,2 @@
-export const attempts = 1;
+export const attempts = 3;
 export const timeout = 1000;
`;

export const mixedDiff =
  featureDiff +
  `@@ -30 +30 @@
-export const label='request';
+export const label = "request";
diff --git a/package.json b/package.json
index 1111111..2222222 100644
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"dependencies":{"library":"1.0.0"}}
+{"dependencies":{"library":"2.0.0"}}
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 1111111..2222222 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-library: 1.0.0
+library: 2.0.0
`;

export function commit(
  id: string,
  changeIds: string[],
  overrides: Partial<PlannedCommit> = {},
): PlannedCommit {
  return {
    id,
    message: "feat: retry requests",
    changeIds,
    rationale: "Increase retry attempts for failed requests.",
    dependencies: [],
    cautions: [],
    ...overrides,
  };
}

export const mixedCommits = [
  commit("dependencies", ["f2.h1", "f3"], {
    message: "build(deps): update library to v2",
    rationale: "Keep the dependency manifest and lockfile in sync.",
  }),
  commit("retry", ["f1.h1"], {
    dependencies: [
      {
        commitId: "dependencies",
        reason: "Review retry behavior against the updated dependency.",
      },
    ],
    cautions: [
      "The diff does not establish whether the library update is required for retries.",
    ],
  }),
  commit("format", ["f1.h2"], {
    message: "style: format request label",
    rationale: "Separate formatting from behavior changes.",
    cautions: [
      "Shares a file with the retry change; split and review manually.",
    ],
  }),
];
