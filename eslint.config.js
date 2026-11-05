const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/", "coverage/", "docs/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.jest } },
  },
];
