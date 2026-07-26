import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dependencyRoot = path.resolve("node_modules");
const legacyImport = "var expand = require('brace-expansion')";
const compatibleImport = [
  "var braceExpansion = require('brace-expansion')",
  "var expand = typeof braceExpansion === 'function'",
  "  ? braceExpansion",
  "  : braceExpansion.expand",
].join("\n");

let patched = 0;

async function visit(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.name === ".bin") return;
      const child = path.join(directory, entry.name);

      if (entry.name === "minimatch") {
        const packagePath = path.join(child, "package.json");
        const sourcePath = path.join(child, "minimatch.js");
        try {
          const metadata = JSON.parse(await readFile(packagePath, "utf8"));
          if (!String(metadata.version).startsWith("3.")) return;
          const source = await readFile(sourcePath, "utf8");
          if (source.includes(compatibleImport)) return;
          if (!source.includes(legacyImport)) {
            throw new Error(
              `Unsupported minimatch ${metadata.version} source at ${sourcePath}`
            );
          }
          await writeFile(
            sourcePath,
            source.replace(legacyImport, compatibleImport),
            "utf8"
          );
          patched += 1;
          return;
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            // Scoped package folders may happen to use this name.
          } else {
            throw error;
          }
        }
      }

      await visit(child);
    })
  );
}

await visit(dependencyRoot);
console.log(`Secure brace-expansion compatibility applied to ${patched} minimatch package(s).`);
