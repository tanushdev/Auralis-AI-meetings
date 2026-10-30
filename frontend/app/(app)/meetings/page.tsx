"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyMeetings, MeetingCard, MeetingCardSkeleton } from "@/components/meetings/MeetingCard";
import { NewMeetingDialog } from "@/components/meetings/NewMeetingDialog";
import { Button, EmptyState, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import type { MeetingListItem } from "@/types";

type Filter = "all" | "active" | "ended";

interface MeetingListResponse {
  page: number;
  limit: number;
  total: number;
  pages: number;
  meetings: MeetingListItem[];
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "12" });
      if (debounced) params.set("search", debounced);
      const data = await api<MeetingListResponse>(`/api/meetings?${params.toString()}`);
      setMeetings(data.meetings);
      setPages(data.pages);
      setTotal(data.total);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load meetings. Check that the backend is running.",
      );
    } finally {
      setLoading(false);
    }
  }, [debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = meetings.filter((meeting) =>
    filter === "all" ? true : meeting.status === filter,
  );

  return (
    <div>
      <PageHeader
        eyebrow="History"
        title="Meetings"
        description="Every room you hosted or joined, with its transcript, summary and duration."
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> New meeting
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border border-line bg-panel p-1">
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["ended", "Ended"],
            ] as Array<[Filter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                filter === value
                  ? "bg-brand text-white"
                  : "text-muted hover:bg-white/5 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search meeting titles…"
            className="pl-9 pr-8"
            aria-label="Search meetings"
          />
          {search ? (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <MeetingCardSkeleton key={index} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        debounced || filter !== "all" ? (
          <EmptyState
            icon={<SlidersHorizontal className="size-6" />}
            title="No meetings match"
            description={
              debounced
                ? `Nothing found for “${debounced}”${filter !== "all" ? ` in ${filter} meetings` : ""}.`
                : `There are no ${filter} meetings on this page.`
            }
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setDebounced("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyMeetings onCreate={() => setNewOpen(true)} />
        )
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((meeting) => (
              <MeetingCard key={meeting._id} meeting={meeting} />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <span>
              {total} meeting{total === 1 ? "" : "s"}
              {debounced ? ` matching “${debounced}”` : ""}
            </span>
            {pages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <span className="font-mono">
                  {page} / {pages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= pages}
                  onClick={() => setPage((value) => Math.min(pages, value + 1))}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <Link
          href="/transcripts"
          className="panel flex items-center gap-3 p-4 transition-colors hover:border-brand/40"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
            <CalendarDays className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Search transcripts</p>
            <p className="text-xs text-muted">Use speaker names and timestamps.</p>
          </div>
        </Link>
        <Link
          href="/recordings"
          className="panel flex items-center gap-3 p-4 transition-colors hover:border-brand/40"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
            <CalendarDays className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Local recordings</p>
            <p className="text-xs text-muted">Play or download files saved in this browser.</p>
          </div>
        </Link>
      </div>

      <NewMeetingDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
