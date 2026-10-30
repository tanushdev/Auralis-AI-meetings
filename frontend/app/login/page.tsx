"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, AudioLines, Lock, ShieldCheck } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const { user, status, refresh, login } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "idle") void refresh();
  }, [status, refresh]);

  useEffect(() => {
    if (status === "ready" && user) router.replace("/dashboard");
  }, [status, user, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r border-line bg-panel/40 lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="pointer-events-none absolute -left-20 top-1/3 size-[420px] rounded-full bg-brand/15 blur-[120px]" />
        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-sky-500">
            <AudioLines className="size-5 text-white" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Auralis.</span>
        </Link>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome back to meetings that <span className="text-gradient">remember everything.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Your transcript, summaries and local recordings are waiting in the dashboard. Audio is
            processed on this machine — never uploaded.
          </p>
          <div className="mt-8 space-y-3">
            {[
              [ShieldCheck, "Authenticated with httpOnly cookies"],
              [Lock, "Guest passes are scoped to one room"],
              [AudioLines, "Live transcription runs locally"],
            ].map(([Icon, label]) => {
              const Component = Icon as typeof ShieldCheck;
              return (
                <div key={String(label)} className="flex items-center gap-2.5 text-xs text-muted">
                  <Component className="size-4 text-brand-soft" />
                  {String(label)}
                </div>
              );
            })}
          </div>
        </div>
        <p className="relative text-xs text-muted/70">
          Next.js · Express · WebRTC · faster-whisper · Ollama
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-sky-500">
                <AudioLines className="size-5 text-white" />
              </span>
              <span className="text-[15px] font-semibold">Auralis.</span>
            </Link>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-sm text-muted">Use your account to access meeting history.</p>

          <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" loading={loading} className="w-full">
              Sign in
              <ArrowRight className="size-4" />
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            New here?{" "}
            <Link href="/register" className="font-medium text-brand-soft hover:underline">
              Create an account
            </Link>
          </p>
          <p className="mt-4 text-center text-xs text-muted">
            Or{" "}
            <Link href="/" className="text-brand-soft hover:underline">
              join a meeting with a link
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
