"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Gavel,
  HelpCircle,
  ListChecks,
  RefreshCw,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import { Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { cn, formatClock, formatDate } from "@/lib/format";
import type { Summary } from "@/types";
import type { SummaryUiState } from "@/store/meetingStore";

function summaryMarkdown(title: string, summary: Summary): string {
  const lines: string[] = [];
  lines.push(`# ${title || "Meeting summary"}`, "");
  const meta = [
    summary.status === "final" ? "Final summary" : "Draft summary",
    summary.generatedAt ? formatDate(summary.generatedAt) : null,
    `${summary.basedOnSegmentCount} transcript segment${summary.basedOnSegmentCount === 1 ? "" : "s"}`,
    summary.model,
  ].filter(Boolean);
  lines.push(`_${meta.join(" · ")}_`);
  if (summary.incompleteTranscript) {
    lines.push("", "> Based on an incomplete transcript.");
  }
  if (summary.executiveSummary) {
    lines.push("", "## Executive summary", "", summary.executiveSummary);
  }
  if (summary.keyPoints.length > 0) {
    lines.push("", "## Key points", "", ...summary.keyPoints.map((item) => `- ${item}`));
  }
  if (summary.decisions.length > 0) {
    lines.push("", "## Decisions", "", ...summary.decisions.map((item) => `- ${item}`));
  }
  if (summary.actionItems.length > 0) {
    lines.push("", "## Action items", "");
    for (const item of summary.actionItems) {
      const details = [
        item.assignee ? `Assignee: ${item.assignee}` : "Unassigned",
        item.deadline ? `Deadline: ${item.deadline}` : "No deadline",
      ];
      lines.push(`- **${item.task}** — ${details.join(" · ")}`);
    }
  }
  if (summary.importantMoments.length > 0) {
    lines.push("", "## Important moments", "");
    for (const moment of summary.importantMoments) {
      lines.push(`- \`${formatClock(moment.time)}\` ${moment.description}`);
    }
  }
  if (summary.openQuestions.length > 0) {
    lines.push("", "## Open questions", "", ...summary.openQuestions.map((item) => `- ${item}`));
  }
  lines.push("", "---", "", "_Generated locally. No meeting data was sent to a third-party AI service._");
  return `${lines.join("\n")}\n`;
}

function summaryFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "meeting"}-summary.md`;
}

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
  meetingTitle = "",
  uiState,
  isHost,
  canGenerate,
  onGenerate,
  onRetry,
  onSeek,
}: {
  summary: Summary | null;
  meetingTitle?: string;
  uiState: SummaryUiState;
  isHost: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onRetry: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const processing = uiState.state === "processing";
  const error = uiState.state === "error" ? uiState.message : summary?.status === "failed" ? summary.error : null;

  const copyMarkdown = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summaryMarkdown(meetingTitle, summary));
      setCopyError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Clipboard access was blocked by the browser.");
    }
  };

  const downloadMarkdown = () => {
    if (!summary) return;
    const blob = new Blob([summaryMarkdown(meetingTitle, summary)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = summaryFileName(meetingTitle);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copyMarkdown()}
            disabled={!summary}
            title="Copy summary as Markdown"
          >
            {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={downloadMarkdown}
            disabled={!summary}
            title="Download summary as Markdown"
          >
            <Download className="size-3.5" />
          </Button>
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
            {summary.status === "draft"
              ? "Live draft: it covers the transcript finalized so far and updates as the meeting continues."
              : "This summary is based on an incomplete transcript (transcription did not finish)."}
          </div>
        ) : null}

        {copyError ? <p className="text-[11px] text-rose-300">{copyError}</p> : null}

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
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5 text-[10px]">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                            item.assignee
                              ? "bg-white/[0.06] text-ink/80"
                              : "bg-white/[0.03] text-muted",
                          )}
                        >
                          <UserRound className="size-2.5" />
                          {item.assignee ?? "Unassigned"}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                            item.deadline
                              ? "bg-white/[0.06] text-ink/80"
                              : "bg-white/[0.03] text-muted",
                          )}
                        >
                          <CalendarClock className="size-2.5" />
                          {item.deadline ?? "No deadline"}
                        </span>
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

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5 text-ink/70">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    summary.status === "final" ? "bg-emerald-400" : "bg-amber-400",
                  )}
                />
                {summary.status === "final" ? "Final summary" : "Live draft"}
              </span>
              <span aria-hidden>·</span>
              <span>
                {summary.basedOnSegmentCount} transcript segment
                {summary.basedOnSegmentCount === 1 ? "" : "s"}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">{summary.model}</span>
              {summary.generatedAt ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatDate(summary.generatedAt)}</span>
                </>
              ) : null}
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
