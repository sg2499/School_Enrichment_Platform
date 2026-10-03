#!/usr/bin/env node
/**
 * Runs the frontend's unit tests (3 Oct 2026).
 *
 *   npm test
 *
 * Why a script and not a test framework. The frontend had no tests at all
 * until the error translator (lib/errors.ts) arrived -- one function that
 * decides what every person sees when anything fails, with a branch for
 * each way a request can fail. That needs tests; it does not need a
 * framework. Node ships a test runner (node:test) and TypeScript is already
 * a dependency, so this adds nothing to package.json or the lockfile: no
 * new packages to audit, no weekly dependency PRs for a test tool.
 *
 * How it works. Each module listed in UNITS is transpiled on its own from
 * TypeScript to an ES module under .test-build/ (ignored by git), and the
 * tests in tests/unit/*.test.mjs import the transpiled copy. Types are not
 * checked here -- `npm run typecheck` does that for the whole project.
 *
 * What can be listed. Only modules with no imports that survive
 * transpiling: type-only imports are erased and are fine; a runtime import
 * of "@/..." or "./..." is not, because nothing here resolves the alias or
 * bundles files together. The script refuses such a module by name rather
 * than failing later with a confusing "cannot find module". That limit is
 * deliberate: logic worth unit-testing is logic worth keeping free of the
 * browser and the framework. (Browser flows belong to the Playwright suite
 * the CI workflow already reserves a job for. When that suite arrives, point
 * its config's testDir at its own folder: Playwright's default pattern
 * would otherwise pick up tests/unit/*.test.mjs as well.)
 *
 * Works on Node 20 and later (CI runs 20).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".test-build");
const TESTS = join(ROOT, "tests", "unit");

// Source file -> the tests that cover it live in tests/unit/<name>.test.mjs.
const UNITS = ["lib/errors.ts", "lib/pageTitle.ts", "lib/sessionNotice.ts"];

/**
 * The first module this transpiled file would load when run, or null. Read
 * from the syntax tree rather than matched as text, so a string or a
 * comment that merely contains the word "from" is not mistaken for an
 * import, and `import "x"` and `import("x")` are not missed.
 */
function firstRuntimeImport(fileName, code) {
  const tree = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  let found = null;
  const visit = (node) => {
    if (found) return;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      found = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const [specifier] = node.arguments;
      found = specifier && ts.isStringLiteralLike(specifier) ? specifier.text : "(a computed module)";
    } else {
      ts.forEachChild(node, visit);
    }
  };
  visit(tree);
  return found;
}

rmSync(BUILD, { recursive: true, force: true });

for (const unit of UNITS) {
  const source = readFileSync(join(ROOT, unit), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: unit,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      // Drop imports that are only used as types, whether or not they are
      // written `import type`.
      verbatimModuleSyntax: false,
      isolatedModules: true,
    },
  });
  const runtimeImport = firstRuntimeImport(unit, outputText);
  if (runtimeImport) {
    console.error(
      `${unit} imports "${runtimeImport}" at runtime, so it cannot be unit-tested on its own.\n` +
        "Move the logic under test into a module with no runtime imports, or take it off the UNITS list\n" +
        "in scripts/run-unit-tests.mjs.",
    );
    process.exit(1);
  }
  const target = join(BUILD, unit.replace(/\.ts$/, ".mjs"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, outputText);
}

// Relative to the folder the runner is started in, with forward slashes: on
// Node 21+ the arguments to --test are glob patterns, and an absolute
// Windows path (backslashes, a drive colon) is not a safe one.
const files = readdirSync(TESTS)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => relative(ROOT, join(TESTS, name)).split("\\").join("/"));

if (files.length === 0) {
  console.error(`No tests found in ${TESTS}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { stdio: "inherit", cwd: ROOT });
process.exit(result.status ?? 1);
