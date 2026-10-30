"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { LoadingScreen } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, status, refresh } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (status === "idle") void refresh();
  }, [status, refresh]);

  useEffect(() => {
    if (status === "ready" && !user) router.replace("/login");
  }, [status, user, router]);

  if (status === "idle" || status === "loading") {
    return <LoadingScreen label="Checking your session" />;
  }
  if (!user) {
    return <LoadingScreen label="Redirecting to sign in" />;
  }

  return (
    <div className="min-h-screen">
      <AppSidebar />
      <main className="min-h-screen pb-20 pt-14 lg:pb-8 lg:pl-64 lg:pt-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
