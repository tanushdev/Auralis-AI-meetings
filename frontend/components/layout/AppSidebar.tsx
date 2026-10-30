"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AudioLines,
  CalendarDays,
  FileText,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import { Avatar } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/format";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/meetings", label: "Meetings", icon: CalendarDays },
  { href: "/transcripts", label: "Transcripts", icon: FileText },
  { href: "/recordings", label: "Recordings", icon: HardDrive },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-panel/70 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-sky-500">
              <AudioLines className="size-5 text-white" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">
              Auralis<span className="text-brand-soft">.</span>
            </span>
          </Link>
        </div>

        <div className="p-3">
          <Link
            href="/dashboard?new=1"
            className="flex h-10 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-medium text-white transition-colors hover:bg-brand-soft"
          >
            <Plus className="size-4" /> New meeting
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                  active
                    ? "bg-brand/15 font-medium text-ink"
                    : "text-muted hover:bg-white/5 hover:text-ink",
                )}
              >
                <Icon className={cn("size-4", active && "text-brand-soft")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar name={user?.name ?? "User"} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="truncate text-[11px] text-muted">{user?.email}</p>
            </div>
            <button
              onClick={() => void signOut()}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-white/5 hover:text-rose-300"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
          <p className="mt-2 px-2 text-[10px] leading-relaxed text-muted/70">
            Local-first · audio processed on this machine
          </p>
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-panel/85 px-4 backdrop-blur-xl lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-sky-500">
            <AudioLines className="size-4 text-white" />
          </span>
          <span className="text-sm font-semibold">Auralis</span>
        </Link>
        <button
          onClick={() => void signOut()}
          className="rounded-lg p-2 text-muted hover:text-rose-300"
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-line bg-panel/95 px-2 py-1.5 backdrop-blur-xl lg:hidden">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px]",
                active ? "text-brand-soft" : "text-muted",
              )}
            >
              <Icon className="size-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
