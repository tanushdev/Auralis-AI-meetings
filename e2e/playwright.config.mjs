import path from "node:path";
import { defineConfig } from "@playwright/test";

const fixtureAudio = path.resolve(import.meta.dirname, "fixtures/speech-48k.wav");
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const skipTunnelWarning = baseURL.includes("ngrok")
  ? { "ngrok-skip-browser-warning": "true" }
  : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 6 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    actionTimeout: 30_000,
    baseURL,
    extraHTTPHeaders: skipTunnelWarning,
    headless: true,
    viewport: { width: 1440, height: 900 },
    permissions: ["camera", "microphone"],
    trace: "retain-on-failure",
    video: "off",
    launchOptions: {
      channel: "chrome",
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${fixtureAudio}`,
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--auto-select-desktop-capture-source=Entire screen",
        "--enable-usermedia-screen-capturing",
      ],
    },
  },
});
