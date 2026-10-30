"use client";

import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Radio,
  Server,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/format";
import type { HealthReport } from "@/types";

type ServiceKey = "database" | "transcription" | "ollama";

const serviceMeta: Record<
  ServiceKey,
  { label: string; detail: string; icon: typeof Database }
> = {
  database: { label: "MongoDB", detail: "Metadata, transcripts, summaries", icon: Database },
  transcription: { label: "faster-whisper", detail: "Live speech-to-text", icon: Radio },
  ollama: { label: "Ollama", detail: "Local language model", icon: BrainCircuit },
};

function serviceState(report: HealthReport, key: ServiceKey): { ok: boolean; detail: string } {
  if (key === "transcription") {
    const service = report.services.transcription;
    const detail = service.modelLoaded
      ? `${service.model ?? report.config.whisperModel} · ${service.device ?? "device"}`
      : service.status === "loading"
        ? "Model loading"
        : service.error ?? "Unavailable";
    return { ok: service.ok && service.modelLoaded !== false, detail };
  }
  if (key === "ollama") {
    const service = report.services.ollama;
    const detail = service.modelAvailable
      ? `${service.model} ready`
      : service.model
        ? `${service.model} not pulled`
        : service.error ?? "Unavailable";
    return { ok: service.ok && service.modelAvailable, detail };
  }
  const service = report.services.database;
  return {
    ok: service.ok,
    detail: service.ok ? `${service.latencyMs} ms` : service.error ?? "Unavailable",
  };
}

export function LocalStackHealth({
  report,
  loading,
  error,
  onRefresh,
  compact = false,
}: {
  report: HealthReport | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  compact?: boolean;
}) {
  return (
    <section className={cn("panel", compact ? "p-4" : "p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4 text-brand-soft" /> Local stack
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">
            Services are checked live; nothing leaves this machine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {report ? (
            <Badge tone={report.ok ? "success" : "warning"} dot>
              {report.ok ? "Healthy" : "Degraded"}
            </Badge>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh service health"
            className="px-2"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className={cn("mt-4 grid gap-2", !compact && "sm:grid-cols-1")}>
        {(Object.keys(serviceMeta) as ServiceKey[]).map((key) => {
          const meta = serviceMeta[key];
          const Icon = meta.icon;
          const state = report ? serviceState(report, key) : null;
          return (
            <div
              key={key}
              className="flex items-center gap-3 rounded-xl border border-line bg-panel-raised/50 px-3 py-2.5"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  state?.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-muted",
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink">{meta.label}</p>
                <p className="truncate text-[10px] text-muted">
                  {loading && !report ? "Checking…" : state?.detail ?? meta.detail}
                </p>
              </div>
              {loading && !report ? (
                <Loader2 className="size-3.5 animate-spin text-muted" />
              ) : state?.ok ? (
                <CheckCircle2 className="size-3.5 text-emerald-400" />
              ) : (
                <AlertTriangle className="size-3.5 text-amber-400" />
              )}
            </div>
          );
        })}
      </div>

      {!compact && report ? (
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-3 text-[10px] text-muted">
          <span>Whisper: {report.config.whisperModel}</span>
          <span>Ollama: {report.config.ollamaModel}</span>
          <span>Mesh limit: {report.config.maxParticipants}</span>
          <span>Checked: {new Date(report.timestamp).toLocaleTimeString()}</span>
        </div>
      ) : null}
    </section>
  );
}
