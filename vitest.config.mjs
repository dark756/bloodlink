import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest 5 (5.0.5 and 5.1.0) on Windows: when the shell's working directory has a
// lower-case drive letter ("c:\…", as VS Code's terminal and cmd give), its workers load
// Vitest from "file:///c:/…" but import it into each test file from "file:///C:/…". Node
// keeps the two as separate modules, so `describe` finds no runner and every file fails
// with "Cannot read properties of undefined (reading 'config')". The vm pools load test
// files another way and don't hit it, so use one only in that case (#62).
const isLowerCaseDrive = process.platform === "win32" && /^[a-z]:/.test(process.cwd());

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    ...(isLowerCaseDrive && { pool: "vmThreads" }),
  },
});
