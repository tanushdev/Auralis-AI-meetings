"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Avatar, Button, Input } from "@/components/ui";
import { cn } from "@/lib/format";
import type { ChatMessage } from "@/types";

export function ChatPanel({
  messages,
  selfId,
  onSend,
  disabled,
}: {
  messages: ChatMessage[];
  selfId: string | null;
  onSend: (message: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const submit = async () => {
    const value = draft.trim();
    if (!value || sending || disabled) return;
    setSending(true);
    setError(null);
    try {
      await onSend(value);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-ink">No messages yet</p>
            <p className="max-w-[220px] text-xs text-muted">
              Messages are saved with the meeting and visible in the meeting history.
            </p>
          </div>
        ) : null}

        {messages.map((message) => {
          const own = message.senderId === selfId;
          return (
            <div key={message.id} className={cn("flex gap-2.5", own && "flex-row-reverse")}>
              <Avatar name={message.senderName} size={28} />
              <div className={cn("max-w-[78%]", own && "text-right")}>
                <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                  <span className="font-medium text-ink/80">
                    {own ? "You" : message.senderName}
                  </span>
                  <span>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm",
                    own
                      ? "bg-brand text-white"
                      : "border border-line bg-panel-raised text-ink",
                  )}
                >
                  {message.message}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line p-3">
        {error ? <p className="mb-2 text-xs text-rose-300">{error}</p> : null}
        <div className="flex items-end gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            maxLength={2000}
            placeholder="Send a message…"
            disabled={disabled}
            aria-label="Chat message"
          />
          <Button
            size="md"
            onClick={() => void submit()}
            disabled={disabled || !draft.trim()}
            loading={sending}
            aria-label="Send message"
            className="shrink-0 px-3"
          >
            {!sending ? <Send className="size-4" /> : null}
          </Button>
        </div>
      </div>
    </div>
  );
}
