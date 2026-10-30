const levels = ["debug", "info", "warn", "error"] as const;
type Level = (typeof levels)[number];

const threshold: Level = (process.env.LOG_LEVEL as Level) || "info";
const rank = (level: Level) => levels.indexOf(level);

function emit(level: Level, message: string, meta?: unknown) {
  if (rank(level) < rank(threshold)) return;
  const stamp = new Date().toISOString();
  const prefix = `[${stamp}] ${level.toUpperCase()}`;
  if (meta !== undefined) {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`, meta);
  } else {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit("debug", message, meta),
  info: (message: string, meta?: unknown) => emit("info", message, meta),
  warn: (message: string, meta?: unknown) => emit("warn", message, meta),
  error: (message: string, meta?: unknown) => emit("error", message, meta),
};
