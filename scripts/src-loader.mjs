// Module hooks that let a plain `node` script import files from src/lib the way Next.js and
// Vitest do: relative imports without ".js", and JSON imported without an attribute. Used
// only by scripts (see register-src.mjs); the app itself never loads this.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const withJs = new URL(`${specifier}.js`, context.parentURL);
    if (fs.existsSync(fileURLToPath(withJs))) return nextResolve(withJs.href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json") && !context.importAttributes?.type) {
    const text = fs.readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${text};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
