"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { parseRoomId } from "@/lib/meetings";

export function JoinMeetingForm({
  compact = false,
  onJoined,
}: {
  compact?: boolean;
  onJoined?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const roomId = parseRoomId(value);
    if (!roomId) {
      setError("Paste a full invite link or a room id like abc-defg-hij.");
      return;
    }
    setError(null);
    onJoined?.();
    router.push(`/meeting/${roomId}`);
  };

  return (
    <form onSubmit={submit} className="w-full">
      <div className={compact ? "flex gap-2" : "flex flex-col gap-2 sm:flex-row"}>
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Paste meeting link or room id"
            aria-label="Meeting link or room id"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!value.trim()} className="shrink-0">
          Join
          <ArrowRight className="size-4" />
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </form>
  );
}
