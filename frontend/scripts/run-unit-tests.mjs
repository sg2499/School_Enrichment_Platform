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
 * What can be listed. A module whose only runtime imports are of OTHER
 * modules on the list (lib/errors.ts reading the product's name from
 * lib/brand.ts, say). Type-only imports are erased and are always fine.
 * Anything else -- a package, a component, a module that is not listed --
 * is refused by name, because nothing here bundles files together, and a
 * clear refusal beats a confusing "cannot find module" later. That limit is
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
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".test-build");
const TESTS = join(ROOT, "tests", "unit");

// Source file -> the tests that cover it live in tests/unit/<name>.test.mjs.
const UNITS = [
  "lib/brand.ts",
  "lib/errors.ts",
  "lib/pageTitle.ts",
  "lib/sessionNotice.ts",
  "lib/signInRole.ts",
  "lib/passwordRules.ts",
];

/**
 * Every module this transpiled file would load when run, as
 * { specifier, start, end } with the positions of the text between the
 * quotes. Read from the syntax tree rather than matched as text, so a
 * string or a comment that merely contains the word "from" is not mistaken
 * for an import, and `import "x"` and `import("x")` are not missed.
 */
function runtimeImports(fileName, code) {
  const tree = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const found = [];
  const record = (literal) => found.push({ specifier: literal.text, start: literal.getStart(tree) + 1, end: literal.getEnd() - 1 });
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      record(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const [specifier] = node.arguments;
      if (specifier && ts.isStringLiteralLike(specifier)) record(specifier);
      else found.push({ specifier: "(a computed module)", start: -1, end: -1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/**
 * The listed unit an import points at ("lib/brand.ts" for "./brand" written
 * in lib/errors.ts, or for "@/lib/brand" written anywhere), or null when it
 * points at anything that is not on the list.
 */
function listedUnit(fromUnit, specifier) {
  let target = null;
  if (specifier.startsWith("@/")) target = specifier.slice(2);
  else if (specifier.startsWith(".")) target = posix.normalize(posix.join(posix.dirname(fromUnit), specifier));
  if (!target) return null;
  const candidate = `${target.replace(/\.(ts|mjs|js)$/, "")}.ts`;
  return UNITS.includes(candidate) ? candidate : null;
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
  // Imports of other listed units are pointed at their transpiled copies;
  // anything else stops the run. Rewritten last-to-first so the positions
  // of the earlier ones stay true.
  let code = outputText;
  for (const found of runtimeImports(unit, outputText).sort((a, b) => b.start - a.start)) {
    const dependency = listedUnit(unit, found.specifier);
    if (!dependency) {
      console.error(
        `${unit} imports "${found.specifier}" at runtime, which is not a listed unit, so it cannot be unit-tested.\n` +
          "Move the logic under test into a module whose only runtime imports are other listed units, add the\n" +
          "imported module to the UNITS list in scripts/run-unit-tests.mjs, or take this one off it.",
      );
      process.exit(1);
    }
    let relativePath = posix.relative(posix.dirname(unit), dependency.replace(/\.ts$/, ".mjs"));
    if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`;
    code = code.slice(0, found.start) + relativePath + code.slice(found.end);
  }
  const target = join(BUILD, unit.replace(/\.ts$/, ".mjs"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, code);
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
