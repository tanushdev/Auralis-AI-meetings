#!/usr/bin/env node
/**
 * Cross-platform launcher for the Python transcription service.
 * Uses the project venv so contributors do not have to activate it manually.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const serviceDir = path.join(root, "transcription");
const candidates = [
  path.join(serviceDir, ".venv", "Scripts", "python.exe"),
  path.join(serviceDir, ".venv", "bin", "python"),
];

const python = candidates.find((candidate) => fs.existsSync(candidate));

if (!python) {
  console.error(
    [
      "Python virtual environment not found.",
      "",
      "Create it first:",
      "  cd transcription",
      "  py -3.11 -m venv .venv",
      "  .venv\\Scripts\\pip install -r requirements.txt   (Windows)",
      "  .venv/bin/pip install -r requirements.txt        (macOS/Linux)",
      "",
      "Then run: npm run dev:transcription",
    ].join("\n"),
  );
  process.exit(1);
}

const port = process.env.TRANSCRIPTION_PORT || "8000";
const child = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
  { cwd: serviceDir, stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 0));
