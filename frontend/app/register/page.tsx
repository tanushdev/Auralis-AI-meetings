"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, AudioLines, BrainCircuit, Radio, ShieldCheck } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const { user, status, refresh, register } = useAuthStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await register(name, email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-sky-500">
                <AudioLines className="size-5 text-white" />
              </span>
              <span className="text-[15px] font-semibold">Auralis.</span>
            </Link>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Create an account</h2>
          <p className="mt-1.5 text-sm text-muted">
            Host meetings, keep transcripts and revisit AI summaries.
          </p>

          <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Aarav Kapoor"
              />
            </div>
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
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat your password"
              />
            </div>

            {error ? (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" loading={loading} className="w-full">
              Create account
              <ArrowRight className="size-4" />
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-soft hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-line bg-panel/40 p-10 lg:flex lg:flex-col lg:justify-center">
        <div className="pointer-events-none absolute -right-20 bottom-0 size-[420px] rounded-full bg-brand/15 blur-[120px]" />
        <div className="relative max-w-md">
          <p className="text-xs font-medium uppercase tracking-widest text-brand-soft">
            Built for localhost
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            Your meeting notes, without <span className="text-gradient">a cloud bill.</span>
          </h1>
          <div className="mt-8 space-y-5">
            {[
              {
                icon: Radio,
                title: "Speech stays on-device",
                text: "Whisper runs through a local Python service. Only text is stored.",
              },
              {
                icon: BrainCircuit,
                title: "Summaries you can audit",
                text: "Every summary is generated from the transcript with timestamped evidence and schema validation.",
              },
              {
                icon: ShieldCheck,
                title: "Real accounts, real guests",
                text: "Hosts get persistent history. Guests get a signed pass for one room.",
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand-soft">
                  <item.icon className="size-4" />
                </span>
                <div>
                  <h3 className="text-sm font-medium">{item.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-xl border border-line bg-panel-raised/50 p-3 text-[11px] leading-relaxed text-muted">
            By creating an account you understand that recordings are stored in this browser and AI
            summaries are generated by a local model that can make mistakes. Always review before
            sharing.
          </div>
        </div>
      </div>
    </div>
  );
}
