"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarPlus, Video } from "lucide-react";
import { Button, Input, Label, Modal } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

interface CreatedMeeting {
  meeting: {
    id: string;
    roomId: string;
    title: string;
    status: string;
    createdAt: string;
    joinUrl: string;
  };
}

export function NewMeetingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setTitle(
      `Team sync · ${now.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`,
    );
    setError(null);
  }, [open]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<CreatedMeeting>("/api/meetings", {
        method: "POST",
        body: { title: title.trim() },
      });
      onClose();
      router.push(`/meeting/${data.meeting.roomId}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not create the meeting. Check that the backend is running.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a meeting"
      description="A room is created instantly. You will set up your camera and microphone before joining."
    >
      <form onSubmit={(event) => void create(event)} className="space-y-4">
        <div>
          <Label htmlFor="meeting-title">Meeting title</Label>
          <Input
            id="meeting-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={140}
            required
            autoFocus
            placeholder="Design review"
          />
          <p className="mt-1.5 text-[11px] text-muted">
            Visible in meeting history, transcripts and summaries.
          </p>
        </div>

        {error ? (
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="flex items-start gap-2 rounded-xl border border-line bg-panel-raised/50 p-3 text-[11px] leading-relaxed text-muted">
          <CalendarPlus className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
          The room stays open until you end it or everyone leaves. Transcripts and summaries are
          saved after the meeting ends.
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={!title.trim()}>
            <Video className="size-4" /> Create & join
          </Button>
        </div>
      </form>
    </Modal>
  );
}
