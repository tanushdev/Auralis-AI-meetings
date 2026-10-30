"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gavel,
  HelpCircle,
  ListChecks,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { cn, formatClock, formatDate } from "@/lib/format";
import type { Summary } from "@/types";
import type { SummaryUiState } from "@/store/meetingStore";

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="text-brand-soft">{icon}</span>
        {title}
        {typeof count === "number" ? (
          <span className="rounded-full bg-white/5 px-1.5 text-[10px] font-normal">{count}</span>
        ) : null}
      </h4>
      {children}
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 24)}`} className="flex gap-2 text-sm text-ink/90">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-soft/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function SummaryPanel({
  summary,
  uiState,
  isHost,
  canGenerate,
  onGenerate,
  onRetry,
  onSeek,
}: {
  summary: Summary | null;
  uiState: SummaryUiState;
  isHost: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onRetry: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const processing = uiState.state === "processing";
  const error = uiState.state === "error" ? uiState.message : summary?.status === "failed" ? summary.error : null;

  if (!summary && !processing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <EmptyState
          icon={<Sparkles className="size-7" />}
          title="No summary yet"
          description={
            canGenerate
              ? "A draft summary is generated periodically during the meeting. You can also generate one now from the finalized transcript."
              : "The host can generate an AI summary from the finalized transcript."
          }
          action={
            isHost && canGenerate ? (
              <Button size="sm" onClick={onGenerate}>
                <Sparkles className="size-3.5" /> Generate draft
              </Button>
            ) : undefined
          }
        />
        {error ? (
          <div className="w-full rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3.5" /> {error}
            </p>
            {isHost ? (
              <Button size="sm" variant="danger" className="mt-2" onClick={onRetry}>
                <RefreshCw className="size-3.5" /> Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          {summary?.status === "draft" ? (
            <Badge tone="warning" dot>
              Draft
            </Badge>
          ) : summary?.status === "final" ? (
            <Badge tone="success" dot>
              Final
            </Badge>
          ) : (
            <Badge tone="brand">Summary</Badge>
          )}
          {summary ? (
            <span className="text-[11px] text-muted">{summary.model}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {isHost ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onGenerate}
              disabled={processing}
              title="Regenerate draft summary"
            >
              {processing ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {processing ? (
          <div className="flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 p-3 text-xs text-brand-soft">
            <Loader />
            <span>
              {uiState.mode === "final"
                ? "Generating the final summary from the saved transcript…"
                : "Generating a draft summary locally…"}
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
            {isHost ? (
              <Button size="sm" variant="danger" className="mt-2" onClick={onRetry}>
                <RefreshCw className="size-3.5" /> Retry summary
              </Button>
            ) : null}
          </div>
        ) : null}

        {summary?.incompleteTranscript ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
            This summary is based on an incomplete transcript (the meeting is still in progress or
            transcription did not finish).
          </div>
        ) : null}

        {summary ? (
          <>
            {summary.executiveSummary ? (
              <Section icon={<Sparkles className="size-3.5" />} title="Executive summary">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">
                  {summary.executiveSummary}
                </p>
              </Section>
            ) : null}

            <Section icon={<Target className="size-3.5" />} title="Key points" count={summary.keyPoints.length}>
              <Bullets items={summary.keyPoints} empty="No key points were identified." />
            </Section>

            <Section icon={<Gavel className="size-3.5" />} title="Decisions" count={summary.decisions.length}>
              <Bullets items={summary.decisions} empty="No confirmed decisions were recorded." />
            </Section>

            <Section icon={<ListChecks className="size-3.5" />} title="Action items" count={summary.actionItems.length}>
              {summary.actionItems.length === 0 ? (
                <p className="text-xs text-muted">No action items were identified.</p>
              ) : (
                <ul className="space-y-2">
                  {summary.actionItems.map((item, index) => (
                    <li
                      key={`${index}-${item.task.slice(0, 24)}`}
                      className="rounded-xl border border-line bg-panel-raised/70 p-2.5"
                    >
                      <p className="flex items-start gap-1.5 text-sm text-ink/90">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                        {item.task}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-3 pl-5 text-[11px] text-muted">
                        <span>Assignee: {item.assignee ?? "not specified"}</span>
                        <span>Deadline: {item.deadline ?? "not specified"}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              icon={<Clock className="size-3.5" />}
              title="Important moments"
              count={summary.importantMoments.length}
            >
              {summary.importantMoments.length === 0 ? (
                <p className="text-xs text-muted">No notable moments were identified.</p>
              ) : (
                <ul className="space-y-1.5">
                  {summary.importantMoments.map((moment, index) => (
                    <li key={`${index}-${moment.time}`} className="flex gap-2 text-sm">
                      <button
                        onClick={() => onSeek?.(moment.time)}
                        disabled={!onSeek}
                        className={cn(
                          "shrink-0 rounded font-mono text-[11px]",
                          onSeek
                            ? "bg-brand/15 px-1.5 py-0.5 text-brand-soft hover:bg-brand/25"
                            : "text-muted",
                        )}
                      >
                        {formatClock(moment.time)}
                      </button>
                      <span className="text-ink/85">{moment.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section icon={<HelpCircle className="size-3.5" />} title="Open questions" count={summary.openQuestions.length}>
              <Bullets items={summary.openQuestions} empty="No open questions were recorded." />
            </Section>

            <div className="border-t border-line pt-3 text-[11px] text-muted">
              Generated locally from {summary.basedOnSegmentCount} transcript segment
              {summary.basedOnSegmentCount === 1 ? "" : "s"}
              {summary.generatedAt ? ` · ${formatDate(summary.generatedAt)}` : ""}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Loader() {
  return <Spinner className="size-4" />;
}
