import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Auralis — Local-first AI meetings",
    template: "%s · Auralis",
  },
  description:
    "Real WebRTC meetings with live local transcription and AI summaries. Your audio never leaves your machine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
