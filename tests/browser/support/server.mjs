/**
 * Static file server for the browser suite, started by playwright.config.ts.
 *
 * Serves the repository root read-only, so a test page can load the BUILT
 * package (dist/) and the fixtures exactly as a consumer's page would. The
 * page itself is supplied per test through `page.route` — see harness.ts.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PORT = Number(process.env.PORT ?? 4178);

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (url === "/__health") {
      res.writeHead(200);
      return res.end("ok");
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`test server on http://127.0.0.1:${PORT}`));
