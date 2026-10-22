import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // eslint-config-next 16 turns on eslint-plugin-react-hooks 7's whole
    // recommended set, which adds the React Compiler rules on top of the two
    // classic hook rules. This app does not use the React Compiler, and on the
    // day of the upgrade those rules flagged 29 working patterns (mostly
    // setState inside an effect). Taking them up is its own piece of work, so
    // they stay off here and the hook rules are exactly what eslint-config-next
    // 15 enforced: rules-of-hooks (error) and exhaustive-deps (warning).
    rules: {
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/config": "off",
      "react-hooks/gating": "off",
    },
  },
  // eslint-config-next already ignores .next/, out/, build/ and next-env.d.ts.
  // .test-build/ is the unit-test runner's transpiled output (scripts/run-unit-tests.mjs).
  globalIgnores([".test-build/**"]),
]);
