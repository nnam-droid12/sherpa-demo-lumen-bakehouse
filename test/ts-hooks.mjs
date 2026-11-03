import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    try {
      return await nextResolve("next/server.js", context);
    } catch {}
  }

  if (specifier.startsWith("@/")) {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const rel = specifier.slice(2);
    const target = path.join(projectRoot, "src", rel);
    if (fs.existsSync(target + ".ts")) {
      return { url: pathToFileURL(target + ".ts").href, shortCircuit: true };
    }
    if (fs.existsSync(target)) {
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" && context.parentURL) {
      const parentPath = fileURLToPath(context.parentURL);
      const target = path.resolve(path.dirname(parentPath), specifier);
      if (fs.existsSync(target + ".ts")) {
        return { url: pathToFileURL(target + ".ts").href, shortCircuit: true };
      }
    }
    throw err;
  }
}
