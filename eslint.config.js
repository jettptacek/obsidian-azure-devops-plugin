// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  
  {
    files: ["src/**/*.ts"],
    plugins: {
      obsidianmd: obsidianmd,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      
      // Obsidian-specific rules
      "obsidianmd/no-sample-code": "warn",
      "obsidianmd/sample-names": "warn", 
      "obsidianmd/prefer-file-manager-trash-file": "error",
      "obsidianmd/no-static-styles-assignment": "warn",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/object-assign": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-tfile-tfolder-cast": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/validate-manifest": "error",
    },
  },
  
  // Special config for manifest.json validation
  {
    files: ["manifest.json"],
    plugins: {
      obsidianmd: obsidianmd,
    },
    rules: {
      "obsidianmd/validate-manifest": "error",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
];