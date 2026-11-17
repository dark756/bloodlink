// Import this first in a script that then imports from ../src/lib (see src-loader.mjs).
import { register } from "node:module";

register("./src-loader.mjs", import.meta.url);
