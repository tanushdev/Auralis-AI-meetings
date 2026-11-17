import { test, expect } from "@playwright/test";

// Smoke test for the public HTTPS tunnel: a host and a guest join through one
// URL with camera/microphone, exchange chat, transcribe speech, and switch
// camera/microphone mid-call without reconnecting.
const BASE = process.env.E2E_BASE_URL;
const HOST_NAME = "Tunnel Host";
const GUEST_NAME = "Tunnel Guest";
const PASSWORD = "AuralisVerify!2026";

test.skip(!BASE, "E2E_BASE_URL is required for the tunnel smoke test");

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function setupAccountAndMeeting() {
  const email = `tunnel-${uniqueSuffix()}@auralis.local`;
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: HOST_NAME, email, password: PASSWORD }),
  });
  if (!register.ok) throw new Error(`Register failed: ${await register.text()}`);
  const cookie = register.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("auth_token="));
  if (!cookie) throw new Error("Registration did not return auth_token");
  const created = await fetch(`${BASE}/api/meetings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: `Tunnel verification ${uniqueSuffix()}` }),
  });
  if (!created.ok) throw new Error(`Meeting creation failed: ${await created.text()}`);
  return { meeting: (await created.json()).meeting, authToken: cookie.split("=")[1] };
}

async function videoCount(page) {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll("video")).filter(
        (video) => video.videoWidth > 0 && video.videoHeight > 0,
      ).length,
  );
}

async function expectVideoCount(page, count, timeout = 90_000) {
  await page.bringToFront();
  await expect
    .poll(() => videoCount(page), { timeout, message: `waiting for ${count} live videos` })
    .toBeGreaterThanOrEqual(count);
}

async function joinGuest(page) {
  await expect(page.getByRole("heading", { name: "What should we call you?" })).toBeVisible();
  await page.locator("#guest-name").fill(GUEST_NAME);
  await page.getByRole("button", { name: /Continue to device setup/ }).click();
  await page.locator("#consent").check();
  await page.getByRole("button", { name: "Join meeting" }).click();
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible({ timeout: 60_000 });
}

test("meeting works through the public HTTPS tunnel", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const { meeting, authToken } = await setupAccountAndMeeting();

  const hostContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  await hostContext.addCookies([
    { name: "auth_token", value: authToken, url: BASE, httpOnly: true, sameSite: "Lax" },
  ]);
  const host = await hostContext.newPage();

  const guestContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const guest = await guestContext.newPage();

  await test.step("host joins over https with local camera", async () => {
    await host.goto(`/meeting/${meeting.roomId}`);
    await expect(host.getByRole("button", { name: "Join meeting" })).toBeVisible({
      timeout: 60_000,
    });
    if (!(await host.evaluate(() => window.isSecureContext))) {
      throw new Error("The page is not a secure context");
    }
    await host.locator("#consent").check();
    await host.getByRole("button", { name: "Join meeting" }).click();
    await expect(host.getByRole("button", { name: "Leave" })).toBeVisible({ timeout: 60_000 });
    await expect(host.locator("header").getByText("1 participant")).toBeVisible();
    await expectVideoCount(host, 1);
    const state = await host.evaluate(() => {
      const stream = document.querySelector("video")?.srcObject;
      return {
        camera: stream instanceof MediaStream && stream.getVideoTracks().length > 0,
        microphone: stream instanceof MediaStream && stream.getAudioTracks().length > 0,
      };
    });
    expect(state.camera).toBe(true);
    expect(state.microphone).toBe(true);
  });

  await test.step("guest joins from the same public URL", async () => {
    await guest.goto(`/meeting/${meeting.roomId}`);
    await joinGuest(guest);
    await expect(host.locator("header").getByText("2 participants")).toBeVisible();
    await expect(guest.locator("header").getByText("2 participants")).toBeVisible();
    await expectVideoCount(host, 2);
    await expectVideoCount(guest, 2);
  });

  await test.step("chat crosses the tunnel", async () => {
    const message = `Tunnel hello ${uniqueSuffix()}`;
    await guest.getByRole("button", { name: "Chat" }).click();
    await guest.getByLabel("Chat message").fill(message);
    await guest.getByRole("button", { name: "Send message" }).click();
    await host.getByRole("button", { name: "Chat" }).click();
    await expect(host.getByRole("complementary").getByText(message)).toBeVisible();
  });

  await test.step("live transcription appears through the tunnel", async () => {
    const startedAt = Date.now();
    await host.getByRole("button", { name: "Live transcript" }).click();
    await expect
      .poll(
        async () => {
          const text = await host.locator("main, body").innerText();
          return (
            text.includes("reviewed the project timeline") || text.includes("Priya will finish")
          );
        },
        { timeout: 60_000, message: "tunnel speech never appeared in the live transcript" },
      )
      .toBe(true);
    console.log(`First live transcript within ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  });

  await test.step("camera and microphone can be switched mid-call", async () => {
    await host.getByRole("button", { name: "Camera & microphone" }).click();
    const cameraSelect = host.locator("#meeting-camera-select");
    const micSelect = host.locator("#meeting-mic-select");
    await expect(cameraSelect).toBeVisible();
    await expect(micSelect).toBeVisible();

    const cameraValue = await cameraSelect.locator("option").nth(1).getAttribute("value");
    const micValue = await micSelect.locator("option").nth(1).getAttribute("value");
    expect(cameraValue).toBeTruthy();
    expect(micValue).toBeTruthy();

    // Pick the explicit device, then return to system default. Both requests
    // must leave the call and the other track intact.
    await cameraSelect.selectOption(cameraValue);
    await expect(cameraSelect).toHaveValue(cameraValue);
    await expectVideoCount(host, 2);
    await expectVideoCount(guest, 2);

    await micSelect.selectOption(micValue);
    await expect(micSelect).toHaveValue(micValue);
    await expect(host.locator("header").getByText("2 participants")).toBeVisible();

    await cameraSelect.selectOption("");
    await expect(cameraSelect).toHaveValue("");
    await micSelect.selectOption("");
    await expect(micSelect).toHaveValue("");
    await expectVideoCount(host, 2);
    await expectVideoCount(guest, 2);

    const trackState = await host.evaluate(() => {
      const stream = document.querySelector("video")?.srcObject;
      return {
        camera: stream instanceof MediaStream && stream.getVideoTracks()[0]?.readyState === "live",
        microphone:
          stream instanceof MediaStream && stream.getAudioTracks()[0]?.readyState === "live",
      };
    });
    expect(trackState.camera).toBe(true);
    expect(trackState.microphone).toBe(true);
  });

  await hostContext.close();
  await guestContext.close();
});
