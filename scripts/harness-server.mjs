// Tiny results sink for the browser validation harness.
// The harness POSTs its live text dump here so results can be read from disk,
// independent of the Claude-in-Chrome extension connection. Dev-only fixture.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "harness-results");
fs.mkdirSync(OUT, { recursive: true });

const PORT = 5174;
const HOST = "127.0.0.1"; // localhost only — never expose this dev sink to the network
const DEV_ORIGIN = "http://localhost:5173"; // the Vite dev server the harness runs in
const MAX_BODY = 8 * 1024 * 1024; // cap accumulated body so a request can't exhaust memory/disk

http
  .createServer((req, res) => {
    // Scope CORS to the dev origin instead of a wildcard.
    res.setHeader("Access-Control-Allow-Origin", DEV_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST") {
      const u = new URL(req.url, "http://x");
      const name = (u.searchParams.get("name") || "result").replace(/[^a-z0-9_.-]/gi, "_");
      let body = "";
      let aborted = false;
      req.on("data", (c) => {
        if (aborted) return;
        body += c;
        if (body.length > MAX_BODY) {
          aborted = true;
          res.writeHead(413);
          res.end("payload too large");
          req.destroy();
        }
      });
      req.on("end", () => {
        if (aborted) return;
        fs.writeFileSync(path.join(OUT, name + ".txt"), body);
        res.writeHead(200);
        res.end("ok");
      });
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, HOST, () => console.log(`harness results server on http://${HOST}:${PORT} -> ${OUT}`));
