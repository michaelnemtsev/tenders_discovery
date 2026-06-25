#!/usr/bin/env node
/*
 * Zero-dependency static file server for the Tender Discovery portal.
 * Serves the project root so the portal (/web/) can fetch /output/tenders.json.
 *
 *   node server.js            -> http://localhost:8000/web/
 *   PORT=3000 node server.js  -> custom port
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 8000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".map": "application/json"
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/web/"; // land on the portal

  // Resolve and prevent path traversal outside ROOT.
  let filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not Found");
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    // No-store so a freshly written output/tenders.json is always picked up.
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Tender Discovery portal running at http://localhost:${PORT}/web/`);
  console.log("Press Ctrl+C to stop.");
});
