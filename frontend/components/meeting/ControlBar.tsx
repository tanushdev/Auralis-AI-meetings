"use client";

import {
  Captions,
  Circle,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Pause,
  PhoneOff,
  Play,
  Sparkles,
  Square,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { cn, formatClock } from "@/lib/format";

export type SidePanel = "chat" | "people" | "transcript" | "summary" | null;

interface Props {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  recording: boolean;
  recordingPaused: boolean;
  elapsed: number;
  activePanel: SidePanel;
  unreadChat: number;
  connectionState: "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onToggleRecord: () => void;
  onPauseRecord: () => void;
  onTogglePanel: (panel: Exclude<SidePanel, null>) => void;
  onLeave: () => void;
}

function ControlButton({
  label,
  active,
  danger,
  disabled,
  onClick,
  children,
  className,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "group relative flex size-11 items-center justify-center rounded-full border transition-all",
        danger
          ? "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
          : active
            ? "border-brand/40 bg-brand/15 text-brand-soft hover:bg-brand/25"
            : "border-line bg-panel-raised text-ink hover:border-brand/40 hover:bg-[#1a2132]",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      {children}
      <span className="pointer-events-none absolute -top-9 whitespace-nowrap rounded-md bg-black/85 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

export function ControlBar({
  audioEnabled,
  videoEnabled,
  screenSharing,
  recording,
  recordingPaused,
  elapsed,
  activePanel,
  unreadChat,
  connectionState,
  onToggleAudio,
  onToggleVideo,
  onToggleScreen,
  onToggleRecord,
  onPauseRecord,
  onTogglePanel,
  onLeave,
}: Props) {
  return (
    <div className="relative z-20 flex flex-wrap items-center justify-center gap-2 border-t border-line bg-panel/90 px-3 py-2.5 backdrop-blur-xl sm:gap-3">
      <div className="flex items-center gap-2">
        <ControlButton label={audioEnabled ? "Mute microphone" : "Unmute microphone"} danger={!audioEnabled} onClick={onToggleAudio}>
          {audioEnabled ? <Mic className="size-4.5" /> : <MicOff className="size-4.5" />}
        </ControlButton>
        <ControlButton label={videoEnabled ? "Turn camera off" : "Turn camera on"} danger={!videoEnabled} onClick={onToggleVideo}>
          {videoEnabled ? <Video className="size-4.5" /> : <VideoOff className="size-4.5" />}
        </ControlButton>
        <ControlButton
          label={screenSharing ? "Stop sharing screen" : "Share screen"}
          active={screenSharing}
          onClick={onToggleScreen}
        >
          {screenSharing ? <MonitorOff className="size-4.5" /> : <MonitorUp className="size-4.5" />}
        </ControlButton>
      </div>

      <span className="mx-1 hidden h-8 w-px bg-line sm:block" />

      <div className="flex items-center gap-2">
        <ControlButton
          label={recording ? "Stop recording" : "Start local recording"}
          danger={recording}
          onClick={onToggleRecord}
        >
          {recording ? <Square className="size-4 fill-current" /> : <Circle className="size-4.5" />}
        </ControlButton>
        {recording ? (
          <>
            <button
              onClick={onPauseRecord}
              title={recordingPaused ? "Resume recording" : "Pause recording"}
              className="flex h-9 items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 font-mono text-[11px] text-rose-200"
            >
              {recordingPaused ? <Play className="size-3" /> : <Pause className="size-3" />}
              {formatClock(elapsed)}
            </button>
          </>
        ) : null}
      </div>

      <span className="mx-1 hidden h-8 w-px bg-line sm:block" />

      <div className="flex items-center gap-1.5">
        <ControlButton
          label="Chat"
          active={activePanel === "chat"}
          onClick={() => onTogglePanel("chat")}
        >
          <MessageSquare className="size-4.5" />
          {unreadChat > 0 && activePanel !== "chat" ? (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white">
              {unreadChat > 9 ? "9+" : unreadChat}
            </span>
          ) : null}
        </ControlButton>
        <ControlButton
          label="Participants"
          active={activePanel === "people"}
          onClick={() => onTogglePanel("people")}
        >
          <Users className="size-4.5" />
        </ControlButton>
        <ControlButton
          label="Live transcript"
          active={activePanel === "transcript"}
          onClick={() => onTogglePanel("transcript")}
        >
          <Captions className="size-4.5" />
        </ControlButton>
        <ControlButton
          label="AI summary"
          active={activePanel === "summary"}
          onClick={() => onTogglePanel("summary")}
        >
          <Sparkles className="size-4.5" />
        </ControlButton>
      </div>

      <span className="mx-1 hidden h-8 w-px bg-line sm:block" />

      <button
        onClick={onLeave}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-rose-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-400"
      >
        <PhoneOff className="size-4" />
        <span className="hidden sm:inline">Leave</span>
      </button>

      {connectionState === "reconnecting" ? (
        <span className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-[11px] text-amber-200">
          Reconnecting…
        </span>
      ) : null}
    </div>
  );
}
