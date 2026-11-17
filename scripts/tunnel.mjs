#!/usr/bin/env node
/**
 * Starts a public HTTPS tunnel to the same-origin gateway.
 *
 * Usage:
 *   npm run gateway       # terminal 1
 *   npm run tunnel        # terminal 2
 *
 * The script reuses the authtoken from the ngrok config that
 * `ngrok config add-authtoken ...` writes, so no secret is stored in this
 * repository. The temporary config exists only for the life of the tunnel.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = process.env.GATEWAY_PORT || "4000";
const ngrokBin = process.env.NGROK_BIN || "ngrok";

function findConfig() {
  const candidates = [
    process.env.NGROK_CONFIG,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "ngrok", "ngrok.yml")
      : null,
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "ngrok", "ngrok.yml")
      : null,
    path.join(os.homedir(), ".config", "ngrok", "ngrok.yml"),
    path.join(os.homedir(), ".ngrok2", "ngrok.yml"),
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

function readToken() {
  if (process.env.NGROK_AUTHTOKEN) return process.env.NGROK_AUTHTOKEN.trim();
  const config = findConfig();
  if (!config) return null;
  const text = fs.readFileSync(config, "utf8");
  const match = /^\s*authtoken:\s*(\S+)\s*$/m.exec(text);
  return match?.[1]?.trim() ?? null;
}

const token = readToken();
if (!token) {
  console.error(
    [
      "No ngrok authtoken found.",
      "",
      "Create a free account at https://dashboard.ngrok.com, then run:",
      "  ngrok config add-authtoken <your-token>",
      "",
      "Alternatively use Cloudflare's free quick tunnel:",
      `  cloudflared tunnel --url http://localhost:${port}`,
    ].join("\n"),
  );
  process.exit(1);
}

const configPath = path.join(os.tmpdir(), `auralis-ngrok-${process.pid}.yml`);

/** Older ngrok builds only accept config version 2. Detect, then fall back. */
function writeConfig() {
  const v3 = `version: 3\nagent:\n  authtoken: ${token}\n`;
  fs.writeFileSync(configPath, v3, { mode: 0o600 });
  const check = spawnSync(ngrokBin, ["config", "check", "--config", configPath], {
    encoding: "utf8",
  });
  if (check.status === 0) return;

  const v2 = `version: 2\nauthtoken: ${token}\n`;
  fs.writeFileSync(configPath, v2, { mode: 0o600 });
  const retry = spawnSync(ngrokBin, ["config", "check", "--config", configPath], {
    encoding: "utf8",
  });
  if (retry.status !== 0) {
    console.error("ngrok rejected the temporary configuration:");
    console.error((retry.stderr || retry.stdout || check.stderr || "").trim());
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try {
    fs.rmSync(configPath, { force: true });
  } catch {
    // ignore
  }
}

writeConfig();

console.log(`Starting HTTPS tunnel to the gateway on port ${port}...`);
const child = spawn(
  ngrokBin,
  [
    "http",
    String(port),
    "--config",
    configPath,
    "--log",
    "stdout",
    "--log-format",
    "json",
    "--log-level",
    "info",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let announced = false;

function announce(url) {
  if (announced) return;
  announced = true;
  console.log("");
  console.log(`  Public HTTPS URL: ${url}`);
  console.log("");
  console.log("  Open this exact URL on BOTH laptops (not localhost).");
  console.log("  If ngrok shows a warning page, click \"Visit Site\".");
  console.log("");
  console.log("  Press Ctrl+C to close the tunnel.");
  console.log("");
}

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const event = JSON.parse(trimmed);
    if (typeof event.url === "string" && event.url.startsWith("https://")) {
      announce(event.url);
      return;
    }
    if (event.lvl === "eror" || event.lvl === "crit") {
      const detail = String(event.err ?? event.msg ?? "").trim();
      if (detail) console.error(detail);
      if (detail.includes("ERR_NGROK_121") || detail.includes("too old")) {
        console.error(
          "\nYour ngrok agent is too old for this account. Run `ngrok update`, then retry `npm run tunnel`.",
        );
      }
      return;
    }
    if (!process.env.AURALIS_TUNNEL_VERBOSE) return;
    console.log(trimmed);
    return;
  } catch {
    // non-JSON output, checked below
  }
  const match = /https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.(?:app|io)/i.exec(trimmed);
  if (match) {
    announce(match[0]);
    return;
  }
  if (process.env.AURALIS_TUNNEL_VERBOSE) console.log(trimmed);
}

child.stdout.on("data", (chunk) => String(chunk).split(/\r?\n/).forEach(handleLine));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(
      [
        "ngrok is not installed or not on PATH.",
        "",
        "Install it, then add your free authtoken:",
        "  winget install ngrok.ngrok        # Windows",
        "  brew install ngrok                # macOS",
        "  ngrok config add-authtoken <token>",
        "",
        "Or use Cloudflare's quick tunnel instead:",
        `  cloudflared tunnel --url http://localhost:${port}`,
      ].join("\n"),
    );
  } else {
    console.error("Could not start ngrok:", error.message);
  }
  cleanup();
  process.exit(1);
});

child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill();
    cleanup();
    process.exit(0);
  });
}
