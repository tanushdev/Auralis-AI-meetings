"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  Copy,
  Database,
  HardDrive,
  KeyRound,
  Laptop,
  LogOut,
  Radio,
  Server,
  ShieldCheck,
  TerminalSquare,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LocalStackHealth } from "@/components/health/LocalStackHealth";
import { Avatar, Badge, Button, Card, Spinner } from "@/components/ui";
import { api, ApiError, API_URL, WS_URL } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { HealthReport } from "@/types";

interface SettingsResponse {
  config: {
    transcriptionProvider: string;
    whisperModel: string;
    aiProvider: string;
    ollamaModel: string;
    maxParticipants: number;
    summaryChunkChars: number;
    summaryIncrementSegments: number;
    summaryIncrementMinMs: number;
    maxUploadMb: number;
  };
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setCopied(false));
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel-raised px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
      title="Copy value"
    >
      {value}
      {copied ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />}
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsResponse["config"] | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      setHealth(await api<HealthReport>("/api/health"));
    } catch (err) {
      setHealthError(err instanceof ApiError ? err.message : "Backend health check failed.");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      const data = await api<SettingsResponse>("/api/settings");
      setSettings(data.config);
    } catch (err) {
      setSettingsError(
        err instanceof ApiError ? err.message : "Could not read backend configuration.",
      );
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    void loadSettings();
  }, [loadHealth, loadSettings]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Account details, local service health and privacy behavior for this installation."
        actions={
          <Button variant="secondary" onClick={() => void signOut()} loading={signingOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-brand-soft" /> Account
          </h2>
          <div className="mt-4 flex items-center gap-3">
            <Avatar name={user?.name ?? "User"} size={48} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>
            <Badge tone="brand" className="ml-auto">
              <KeyRound className="size-3" /> Signed in
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-panel-raised/50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Authentication</p>
              <p className="mt-1 text-xs">httpOnly JWT cookie</p>
              <p className="mt-0.5 text-[10px] text-muted">SameSite=Lax · no token in localStorage</p>
            </div>
            <div className="rounded-xl border border-line bg-panel-raised/50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Guest access</p>
              <p className="mt-1 text-xs">Room-scoped signed pass</p>
              <p className="mt-0.5 text-[10px] text-muted">Cannot open another host's history</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            Profile editing and password changes are not exposed in this build. Account creation and
            login are fully implemented; account data lives in local MongoDB.
          </p>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-emerald-300" /> Privacy boundaries
          </h2>
          <div className="mt-3 space-y-3 text-[11px] leading-relaxed text-muted">
            <div className="flex gap-2">
              <Database className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
              <p>
                <span className="font-medium text-ink/90">MongoDB stores text only:</span> users,
                meetings, participants, chat, transcript segments, summaries and recording metadata.
                No audio or video blobs are written to the database.
              </p>
            </div>
            <div className="flex gap-2">
              <Radio className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
              <p>
                <span className="font-medium text-ink/90">Microphone audio</span> is streamed as PCM
                to the Node backend, forwarded to the local Python service, and never sent to a cloud
                speech API.
              </p>
            </div>
            <div className="flex gap-2">
              <BrainCircuit className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
              <p>
                <span className="font-medium text-ink/90">Transcript text</span> is sent only to the
                local Ollama server for summarization. If Ollama is down, the app reports the error
                and offers retry; it does not fabricate a summary.
              </p>
            </div>
            <div className="flex gap-2">
              <HardDrive className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
              <p>
                <span className="font-medium text-ink/90">Recordings</span> are stored in IndexedDB in
                this browser. Deleting browser storage removes them; server metadata remains until
                removed from MongoDB.
              </p>
            </div>
          </div>
        </Card>

        <LocalStackHealth
          report={health}
          loading={healthLoading}
          error={healthError}
          onRefresh={() => void loadHealth()}
        />

        <Card>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Laptop className="size-4 text-brand-soft" /> Local configuration
          </h2>
          {settingsError ? (
            <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
              {settingsError}
            </p>
          ) : settings ? (
            <dl className="mt-3 divide-y divide-line text-xs">
              {[
                ["Speech provider", settings.transcriptionProvider],
                ["Whisper model", settings.whisperModel],
                ["AI provider", settings.aiProvider],
                ["Ollama model", settings.ollamaModel],
                ["Mesh participant cap", String(settings.maxParticipants)],
                ["Summary chunk size", `${settings.summaryChunkChars} characters`],
                ["Incremental summary trigger", `${settings.summaryIncrementSegments} final segments`],
                ["Incremental cooldown", `${Math.round(settings.summaryIncrementMinMs / 1000)} seconds`],
                ["Max audio upload", `${settings.maxUploadMb} MB`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right font-medium text-ink/90">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          <p className="mt-3 text-[10px] leading-relaxed text-muted">
            Change these values in the root <span className="font-mono">.env</span>, run{" "}
            <span className="font-mono">npm run setup</span>, then restart the affected service.
          </p>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4 text-brand-soft" /> Endpoints
          </h2>
          <div className="mt-3 space-y-3">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Backend API</p>
              <CopyValue value={API_URL} />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Signaling WebSocket</p>
              <CopyValue value={`${WS_URL}/ws`} />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">
                Transcription service
              </p>
              <CopyValue value="http://127.0.0.1:8000" />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Ollama</p>
              <CopyValue value="http://127.0.0.1:11434" />
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-panel-raised/40 p-2.5 text-[10px] leading-relaxed text-muted">
            <TerminalSquare className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
            These services bind to localhost. Do not expose ports 5000, 8000 or 11434 directly to the
            public internet without authentication and TLS.
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-amber-300" /> Known limitations
          </h2>
          <div className="mt-3 grid gap-3 text-[11px] leading-relaxed text-muted sm:grid-cols-2">
            <p>
              <span className="font-medium text-ink/90">Mesh topology.</span> Every participant sends
              media to every other participant. The default cap is {settings?.maxParticipants ?? 6};
              beyond that, bandwidth and CPU grow quickly.
            </p>
            <p>
              <span className="font-medium text-ink/90">No TURN server.</span> The app uses
              environment-configured STUN servers. Symmetric NAT or restrictive corporate networks can
              prevent a direct peer connection, and no paid TURN relay is included.
            </p>
            <p>
              <span className="font-medium text-ink/90">Streaming latency.</span> faster-whisper is not
              instantaneous. This build uses overlapping windows and provisional text; expect a few
              seconds of delay, with more on CPU.
            </p>
            <p>
              <span className="font-medium text-ink/90">Browser recording.</span> MediaRecorder support
              and container/codec choice vary by browser. Whole-meeting recording composites video
              through a canvas and mixes audio with WebAudio; high participant counts can drop frames.
            </p>
            <p>
              <span className="font-medium text-ink/90">Data retention.</span> Meeting text persists in
              MongoDB until manually removed. Local recordings persist in this browser until deleted
              here or browser storage is cleared.
            </p>
            <p>
              <span className="font-medium text-ink/90">Consent.</span> The pre-join screen requires
              consent before transcription begins. Recording can be started later; the meeting header
              shows a persistent recording indicator to all participants on that client.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
