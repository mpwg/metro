import { mkdir, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const result = await Bun.build({
  entrypoints: ["src/index.html"],
  outdir: "dist",
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
const worker = await Bun.build({
  entrypoints: ["src/simulation-worker.ts"],
  outdir: "dist",
  naming: "simulation-worker.js",
  target: "browser",
  format: "esm",
  minify: true,
});
if (!worker.success) {
  console.error(worker.logs);
  process.exit(1);
}
await Bun.write("dist/LICENSE.txt", Bun.file("LICENSE"));
await Bun.write(
  "dist/THIRD_PARTY_NOTICES.md",
  Bun.file("THIRD_PARTY_NOTICES.md"),
);
for await (const file of new Bun.Glob("licenses/*.txt").scan(".")) {
  await Bun.write(`dist/${file}`, Bun.file(file));
}
console.log(
  `Metro gebaut: ${result.outputs.length + worker.outputs.length} Dateien in dist/`,
);
