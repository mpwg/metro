import { resolve, sep } from "node:path";
const root = resolve("dist");
if (!(await Bun.file(resolve(root, "index.html")).exists()))
  throw new Error("Zuerst bun run build ausführen.");
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const target = resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!target.startsWith(root + sep))
      return new Response("Nicht erlaubt", { status: 403 });
    const file = Bun.file(target);
    return (await file.exists())
      ? new Response(file)
      : new Response("Nicht gefunden", { status: 404 });
  },
});
console.log(`Metro: ${server.url}`);
