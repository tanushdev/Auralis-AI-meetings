"use client";

import { create } from "zustand";
import { api, ApiError } from "@/lib/api";
import type { GuestInfo, User } from "@/types";

interface AuthState {
  user: User | null;
  guest: GuestInfo | null;
  status: "idle" | "loading" | "ready";
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setGuest: (guest: GuestInfo | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  guest: null,
  status: "idle",

  refresh: async () => {
    set({ status: "loading" });
    try {
      const data = await api<{ user: User | null; guest: GuestInfo | null }>("/api/auth/me");
      set({ user: data.user, guest: data.guest, status: "ready" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ user: null, guest: null, status: "ready" });
        return;
      }
      set({ status: "ready" });
    }
  },

  login: async (email, password) => {
    const data = await api<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    set({ user: data.user, guest: null, status: "ready" });
  },

  register: async (name, email, password) => {
    const data = await api<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
    });
    set({ user: data.user, guest: null, status: "ready" });
  },

  logout: async () => {
    await api("/api/auth/logout", { method: "POST" });
    set({ user: null, guest: null, status: "ready" });
  },

  setGuest: (guest) => set({ guest }),

  clear: () => set({ user: null, guest: null, status: "idle" }),
}));
