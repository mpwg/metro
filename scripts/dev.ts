import homepage from "../src/index.html";
const port = Number(process.env.PORT ?? 3000);
const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  development: { hmr: true, console: true },
  routes: {
    "/": homepage,
    "/simulation-worker.js": async () => {
      const build = await Bun.build({
        entrypoints: ["src/simulation-worker.ts"],
        target: "browser",
        format: "esm",
        minify: false,
      });
      if (!build.success)
        return new Response(build.logs.join("\n"), { status: 500 });
      return new Response(build.outputs[0], {
        headers: { "Content-Type": "text/javascript" },
      });
    },
  },
});
console.log(`Metro: ${server.url}`);
