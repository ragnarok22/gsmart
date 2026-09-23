/** Representative large patches generated in memory to avoid checked-in megabytes. */
export function sourceDiff(path = "src/handlers.ts", count = 5000): string {
  return (
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n` +
    Array.from(
      { length: count },
      (_, i) =>
        `@@ -${i * 4 + 1},3 +${i * 4 + 1},3 @@ export async function handle${i}(request)\n-  return fetch(request.url);\n+  return retry(() => fetch(request.url), { attempts: 3 });\n   // Preserve the response body: café 界 😀\n`,
    ).join("")
  );
}

export function lockfileDiff(count = 2000): string {
  return (
    "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n--- a/pnpm-lock.yaml\n+++ b/pnpm-lock.yaml\n@@ -1,6000 +1,6000 @@ packages:\n" +
    Array.from(
      { length: count },
      (_, i) =>
        `-  library-${i}@1.0.0:\n-    resolution: {integrity: sha512-${"a".repeat(80)}}\n+  library-${i}@2.0.0:\n+    resolution: {integrity: sha512-${"b".repeat(80)}}\n`,
    ).join("")
  );
}
