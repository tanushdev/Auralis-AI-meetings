import Link from "next/link";
import { AudioLines } from "lucide-react";
import { cn } from "@/lib/format";

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-sky-500 shadow-[0_10px_30px_-10px_rgba(108,92,231,0.9)]">
        <AudioLines className="size-5 text-white" />
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tight">
          Auralis<span className="text-brand-soft">.</span>
        </span>
      ) : null}
    </Link>
  );
}
