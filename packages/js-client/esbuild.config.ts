/**
 * esbuild configuration for @traffical/js-client
 *
 * Produces:
 * - dist/traffical.min.js - IIFE bundle for CDN/script tag usage
 * - dist/traffical.min.js.map - Source map
 */

import { build } from "esbuild";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

async function main() {
  console.log(`Building @traffical/js-client v${pkg.version}...`);

  // IIFE build for CDN
  const result = await build({
    entryPoints: ["src/global.ts"],
    outfile: "dist/traffical.min.js",
    format: "iife",
    globalName: "Traffical",
    bundle: true,
    minify: true,
    sourcemap: true,
    target: ["es2020"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    metafile: true,
    banner: {
      js: `/* @traffical/js-client v${pkg.version} */`,
    },
  });

  // Calculate bundle size
  const outputs = Object.entries(result.metafile?.outputs ?? {});
  for (const [file, info] of outputs) {
    if (file.endsWith(".js")) {
      const sizeKb = (info.bytes / 1024).toFixed(2);
      console.log(`  ${file}: ${sizeKb} KB`);
    }
  }

  console.log("Build complete!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

