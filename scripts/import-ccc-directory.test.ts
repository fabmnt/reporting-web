import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "import-ccc-directory.ts");

/**
 * The script runs under Node's type stripping, which resolves only the paths
 * written in the modules it loads. One app module that imports another without
 * an extension stops the script before it reads anything, which is how it
 * broke: `clientKeyFromName` moved into a module that imports `./appErrors`.
 */
describe("the directory import script", () => {
  it("imports nothing from the app but the module Node loads on its own", async () => {
    const source = await readFile(scriptPath, "utf8");
    const relativeImports = [...source.matchAll(/from "(\.[^"]*)"/g)].map((match) => match[1]);
    expect(
      relativeImports,
      "Only a module that imports nothing itself can be loaded by the script's type stripping. " +
        "Add one here only if it stands alone the way convex/model/clientKey.ts does."
    ).toEqual(["../convex/model/clientKey.ts"]);

    const [helperPath] = relativeImports;
    const helperUrl = pathToFileURL(path.resolve(path.dirname(scriptPath), helperPath));
    await expect(
      execFileAsync(process.execPath, ["-e", `import(${JSON.stringify(helperUrl.href)})`], {
        cwd: repoRoot,
      })
    ).resolves.toBeDefined();
  });
});
