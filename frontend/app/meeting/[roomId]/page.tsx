"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Loader2,
  Lock,
  ShieldCheck,
  Users,
  Video,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { MeetingExperience } from "@/components/meeting/MeetingExperience";
import { Avatar, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuthStore } from "@/store/authStore";
import type { RoomPublic } from "@/types";

export default function MeetingEntryPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { user, guest, status, refresh, setGuest } = useAuthStore();

  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestLoading, setGuestLoading] = useState(false);

  const loadRoom = useCallback(async () => {
    setLoadingRoom(true);
    setRoomError(null);
    try {
      const data = await api<{ room: RoomPublic }>(`/api/meetings/room/${roomId}`);
      setRoom(data.room);
    } catch (err) {
      setRoomError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the meeting. Check that the backend is running.",
      );
    } finally {
      setLoadingRoom(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (status === "idle") void refresh();
  }, [status, refresh]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  const joinAsGuest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!guestName.trim()) return;
    setGuestLoading(true);
    setGuestError(null);
    try {
      const data = await api<{ guest: { name: string; roomId: string } }>("/api/auth/guest", {
        method: "POST",
        body: { roomId, name: guestName.trim() },
      });
      setGuest(data.guest);
    } catch (err) {
      setGuestError(
        err instanceof ApiError ? err.message : "Could not create a guest pass for this room.",
      );
    } finally {
      setGuestLoading(false);
    }
  };

  if (loadingRoom || status === "idle" || status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Logo />
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Checking the meeting room…
        </div>
      </div>
    );
  }

  if (roomError || !room) {
    return (
      <GateShell title="Meeting unavailable" subtitle="We could not open this room.">
        <Card className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-300">
              <AlertTriangle className="size-6" />
            </span>
            <p className="text-sm font-medium">{roomError ?? "That meeting does not exist."}</p>
            <p className="text-xs text-muted">
              Double-check the invite link. Room ids look like <span className="font-mono">abc-defg-hij</span>.
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void loadRoom()}>
                Try again
              </Button>
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="size-3.5" /> Home
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </GateShell>
    );
  }

  if (room.status === "ended") {
    return (
      <GateShell title="This meeting has ended" subtitle={room.title}>
        <Card className="w-full max-w-lg">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/15 text-brand-soft">
              <Video className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">{room.title}</h2>
            <p className="text-sm text-muted">
              Hosted by {room.hostName}
              {room.startedAt ? ` · started ${formatDate(room.startedAt)}` : ""}. The room is no
              longer accepting participants.
            </p>
            {user ? (
              <Link href="/meetings">
                <Button className="mt-1" size="sm">
                  Browse meeting history <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            ) : (
              <Link href="/">
                <Button className="mt-1" size="sm">
                  Back to Auralis <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            )}
          </div>
        </Card>
      </GateShell>
    );
  }

  const hasAccess = Boolean(user) || guest?.roomId === roomId;

  if (!hasAccess) {
    return (
      <GateShell title="Join the meeting" subtitle={room.title}>
        <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="hidden flex-col justify-between rounded-2xl border border-line bg-panel/60 p-6 lg:flex">
            <div>
              <Badge tone="brand" dot>
                Guest entry
              </Badge>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">{room.title}</h2>
              <p className="mt-2 text-sm text-muted">
                Hosted by {room.hostName}
                {room.startedAt ? ` · live since ${formatDate(room.startedAt)}` : ""}
              </p>
              <div className="mt-6 space-y-3 text-xs text-muted">
                <p className="flex items-center gap-2">
                  <Users className="size-4 text-brand-soft" /> {room.participantCount} participant
                  {room.participantCount === 1 ? "" : "s"} in the room now
                </p>
                <p className="flex items-center gap-2">
                  <AudioLines className="size-4 text-brand-soft" /> Live local transcription by
                  faster-whisper
                </p>
                <p className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-brand-soft" /> Your guest pass is scoped to this
                  room only
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-panel-raised/50 p-3 text-[11px] leading-relaxed text-muted">
              This installation runs on the host's machine. Audio is processed locally and is not sent
              to a cloud speech service.
            </div>
          </div>

          <Card>
            <div className="flex items-center gap-2 text-xs font-medium text-brand-soft">
              <Lock className="size-3.5" /> Guest access
            </div>
            <h2 className="mt-2 text-xl font-semibold">What should we call you?</h2>
            <p className="mt-1 text-sm text-muted">
              Your name is attached to your transcript segments and chat messages. Guests cannot
              browse the host's meeting history.
            </p>

            <form onSubmit={(event) => void joinAsGuest(event)} className="mt-5 space-y-4">
              <div>
                <Label htmlFor="guest-name">Display name</Label>
                <Input
                  id="guest-name"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  placeholder="Mira Sharma"
                  maxLength={60}
                  required
                  autoFocus
                  autoComplete="name"
                />
              </div>
              {guestError ? (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {guestError}
                </p>
              ) : null}
              <Button type="submit" loading={guestLoading} className="w-full" disabled={!guestName.trim()}>
                Continue to device setup <ArrowRight className="size-4" />
              </Button>
            </form>

            <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
              <p className="text-xs text-muted">Have an account?</p>
              <Link href="/login" className="text-xs font-medium text-brand-soft hover:underline">
                Sign in instead
              </Link>
            </div>
          </Card>
        </div>
      </GateShell>
    );
  }

  return (
    <MeetingExperience
      room={room}
      displayName={user?.name ?? guest?.name ?? "Guest"}
      isGuest={Boolean(!user && guest)}
    />
  );
}

function GateShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <Logo />
        <Link href="/" className="text-xs text-muted transition-colors hover:text-ink">
          <ArrowLeft className="mr-1 inline size-3.5" /> Back
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-14">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {children}
        <div className="mt-8 flex items-center gap-2 text-[10px] text-muted/70">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Local-first meetings · Auralis
        </div>
      </main>
    </div>
  );
}
