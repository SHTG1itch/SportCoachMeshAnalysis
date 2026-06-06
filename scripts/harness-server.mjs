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
http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST") {
      const u = new URL(req.url, "http://x");
      const name = (u.searchParams.get("name") || "result").replace(/[^a-z0-9_.-]/gi, "_");
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        fs.writeFileSync(path.join(OUT, name + ".txt"), body);
        res.writeHead(200);
        res.end("ok");
      });
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => console.log(`harness results server on http://localhost:${PORT} -> ${OUT}`));
