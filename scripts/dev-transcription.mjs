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
const childEnv = { ...process.env };

// CUDA builds of CTranslate2 need cuBLAS/cuDNN on the loader path. The GPU
// requirements install them as wheels inside the venv, so add those folders
// explicitly instead of asking Windows users to edit system PATH.
const venvDir = path.join(serviceDir, ".venv");
const nvidiaCandidates = [path.join(venvDir, "Lib", "site-packages", "nvidia")];
for (const libDir of ["lib", "lib64"]) {
  const pythonLibs = path.join(venvDir, libDir);
  if (!fs.existsSync(pythonLibs)) continue;
  for (const entry of fs.readdirSync(pythonLibs)) {
    if (entry.startsWith("python")) {
      nvidiaCandidates.push(path.join(pythonLibs, entry, "site-packages", "nvidia"));
    }
  }
}
const nvidiaRoot = nvidiaCandidates.find((candidate) => fs.existsSync(candidate));if (fs.existsSync(nvidiaRoot)) {
  const dllDirs = fs
    .readdirSync(nvidiaRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(nvidiaRoot, entry.name, "bin"))
    .filter((dir) => fs.existsSync(dir));
  if (dllDirs.length > 0) {
    const key = process.platform === "win32" ? "Path" : "LD_LIBRARY_PATH";
    const existing = childEnv[key] ?? "";
    childEnv[key] = [...dllDirs, existing].filter(Boolean).join(path.delimiter);
  }
}

const child = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
  { cwd: serviceDir, stdio: "inherit", env: childEnv },
);

child.on("exit", (code) => process.exit(code ?? 0));
