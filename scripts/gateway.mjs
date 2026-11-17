#!/usr/bin/env node
/**
 * Same-origin gateway for remote meetings.
 *
 * A browser only lets the app use camera/microphone on a secure origin, and
 * cookies/WebSockets are simplest when the frontend and API share one origin.
 * This gateway serves both behind a single port:
 *
 *   /api/*  -> backend  (http://127.0.0.1:5000)
 *   /ws     -> backend  (WebSocket signaling)
 *   else    -> frontend (http://127.0.0.1:3000)
 *
 * Point one HTTPS tunnel at this port (for example `ngrok http 4000`) and the
 * resulting https:// URL works for every participant, with device capture.
 *
 * The gateway binds to loopback by default, so nothing is exposed except
 * through the tunnel. Set GATEWAY_HOST=0.0.0.0 for plain-LAN access (which
 * still cannot use camera/microphone because it is not a secure context).
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

// Read the root .env so GATEWAY_PORT / GATEWAY_HOST can live next to every
// other setting. Real process env always wins.
try {
  const text = fs.readFileSync(path.resolve(import.meta.dirname, "../.env"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) process.env[key] = value.trim();
  }
} catch {
  // .env is optional; defaults below still work.
}

const port = Number(process.env.GATEWAY_PORT || 4000);
const host = process.env.GATEWAY_HOST || "127.0.0.1";
const backend = new URL(process.env.BACKEND_ORIGIN || "http://127.0.0.1:5000");
// Use localhost (not 127.0.0.1): Next's dev runtime only trusts localhost by
// default, and treating its own rewritten requests as cross-origin blocks the
// client runtime and prevents hydration.
const frontend = new URL(process.env.FRONTEND_ORIGIN || "http://localhost:3000");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const isBackendPath = (pathname) =>
  pathname === "/api" || pathname.startsWith("/api/") || pathname === "/ws";

/** Copy request headers, rewriting Host/Origin for the upstream target. */
function upstreamHeaders(req, target, { upgrade = false } = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const name = key.toLowerCase();
    if (value === undefined) continue;
    if (!upgrade && HOP_BY_HOP.has(name)) continue;
    if (name === "host") continue;
    headers[name] = value;
  }

  headers.host = target.host;
  // The browser's public origin is the tunnel host. The backend does not need
  // it (same-origin proxying means CORS is never involved); Next.js compares
  // Origin against Host for server actions, so align it with the target.
  if (target === frontend) {
    if (headers.origin) headers.origin = target.origin;
  } else {
    delete headers.origin;
  }

  const forwardedFor = req.socket.remoteAddress;
  const existing = req.headers["x-forwarded-for"];
  headers["x-forwarded-for"] = existing ? `${existing}, ${forwardedFor}` : String(forwardedFor);
  // Keep the forwarded host aligned with the rewritten Host. Next.js uses
  // these headers for its dev-origin check; leaving the public tunnel host
  // here makes it reject dev resources as cross-origin.
  headers["x-forwarded-host"] = target.host;
  headers["x-forwarded-proto"] =
    target === frontend
      ? target.protocol.replace(":", "")
      : String(req.headers["x-forwarded-proto"] || "http");
  return headers;
}

function proxyHttp(req, res) {
  const url = new URL(req.url || "/", "http://gateway.local");
  const target = isBackendPath(url.pathname) ? backend : frontend;

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders(req, target),
    },
    (upstreamRes) => {
      const headers = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined) continue;
        if (HOP_BY_HOP.has(key.toLowerCase())) continue;
        headers[key] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, headers);
      upstreamRes.pipe(res);
      upstreamRes.on("error", () => res.destroy());
    },
  );

  upstream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Gateway could not reach ${target.origin}: ${error.message}. Is that service running?`,
      }),
    );
  });

  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

/** Raw WebSocket/HTTP upgrade proxying (both signaling and Next dev HMR). */
function proxyUpgrade(req, socket, head) {
  const url = new URL(req.url || "/", "http://gateway.local");
  const target = isBackendPath(url.pathname) ? backend : frontend;
  const headers = upstreamHeaders(req, target, { upgrade: true });

  const upstream = net.connect(Number(target.port), target.hostname, () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
    for (const [key, value] of Object.entries(headers)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item === undefined) continue;
        upstream.write(`${key}: ${item}\r\n`);
      }
    }
    upstream.write("\r\n");
    if (head?.length) upstream.write(head);

    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  const fail = () => {
    if (socket.destroyed) return;
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  };

  upstream.on("error", fail);
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
}

const server = http.createServer(proxyHttp);
server.on("upgrade", proxyUpgrade);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Set GATEWAY_PORT to a free port and update the tunnel target.`,
    );
  } else {
    console.error("Gateway error:", error);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Gateway listening on http://${host}:${port}`);
  console.log(`  /api and /ws -> ${backend.origin}`);
  console.log(`  everything else -> ${frontend.origin}`);
  console.log(`\nExpose it with an HTTPS tunnel, then open the https:// URL:`);
  console.log(`  ngrok http ${port}`);
});
