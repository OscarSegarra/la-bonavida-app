import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "module", pattern: "src/modules/*", capture: ["moduleName"] },
        { type: "app", pattern: "src/app/**" },
        { type: "lib", pattern: "src/lib/**" },
      ],
    },
    rules: {
      // A module's domain/data/ui internals are private. Anything outside
      // the module (app/, lib/, or another module) may only import the
      // module's index.ts connector — never reach into its internals.
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: { element: { type: "*" } },
              allow: {
                to: { element: { type: "module", fileInternalPath: "index.ts" } },
              },
            },
            {
              from: { element: { type: "*" } },
              allow: { to: { element: { type: ["app", "lib"] } } },
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
