import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:5000";
const HOST_NAME = "Browser Host";
const GUEST_ONE = "Browser Guest";
const GUEST_TWO = "Camera-less Guest";
const PASSWORD = "AuralisVerify!2026";

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function setupAccountAndMeeting() {
  const email = `browser-${uniqueSuffix()}@auralis.local`;
  const register = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: HOST_NAME, email, password: PASSWORD }),
  });
  if (!register.ok) throw new Error(`Register failed: ${await register.text()}`);
  const setCookies = register.headers.getSetCookie();
  const cookie = setCookies
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("auth_token="));
  if (!cookie) throw new Error("Registration did not return auth_token");
  const authToken = cookie.slice("auth_token=".length);
  const title = `Browser verification ${uniqueSuffix()}`;
  const created = await fetch(`${API}/api/meetings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title }),
  });
  if (!created.ok) throw new Error(`Meeting creation failed: ${await created.text()}`);
  const body = await created.json();
  return { title, meeting: body.meeting, authToken };
}

async function videoStats(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("video")).map((video) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
    })),
  );
}

async function expectVideoCount(page, count, timeout = 60_000) {
  // Background tabs can suspend rendering of remote WebRTC video elements, so
  // videoWidth stays 0 even though the track is live. Bring the participant
  // whose videos we are asserting to the foreground first.
  await page.bringToFront();
  await expect
    .poll(
      async () => {
        const stats = await videoStats(page);
        return stats.filter((video) => video.width > 0 && video.height > 0).length;
      },
      { timeout, message: `expected at least ${count} live remote video elements` },
    )
    .toBeGreaterThanOrEqual(count);
}

async function readLocalRecordings(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("auralis-recordings", 1);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("recordings")) {
            resolve({ count: 0, sizes: [] });
            return;
          }
          const transaction = db.transaction("recordings", "readonly");
          const all = transaction.objectStore("recordings").getAll();
          all.onerror = () => reject(all.error ?? new Error("IndexedDB read failed"));
          all.onsuccess = () => {
            const records = all.result;
            resolve({
              count: records.length,
              sizes: records.map((record) => record.blob?.size ?? record.sizeBytes ?? 0),
            });
          };
        };
      }),
  );
}

async function joinGuest(page, name) {
  await expect(page.getByRole("heading", { name: "What should we call you?" })).toBeVisible();
  await page.locator("#guest-name").fill(name);
  await page.getByRole("button", { name: /Continue to device setup/ }).click();
  await expect(page.getByRole("button", { name: "Join meeting" })).toBeVisible();
  await page.locator("#consent").check();
  await page.getByRole("button", { name: "Join meeting" }).click();
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible({ timeout: 60_000 });
}

test("real three-participant meeting over native WebRTC", async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const { title, meeting, authToken } = await setupAccountAndMeeting();
  const contexts = [];
  const consoleErrors = [];

  const hostContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  contexts.push(hostContext);
  await hostContext.addCookies([
    {
      name: "auth_token",
      value: authToken,
      url: "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const host = await hostContext.newPage();
  host.on("pageerror", (error) => consoleErrors.push(`host pageerror: ${error.message}`));

  const guestOneContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  contexts.push(guestOneContext);
  const guestOne = await guestOneContext.newPage();
  guestOne.on("pageerror", (error) => consoleErrors.push(`guest1 pageerror: ${error.message}`));

  const guestTwoContext = await browser.newContext();
  contexts.push(guestTwoContext);
  await guestTwoContext.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__testMediaEnabled = false;
    window.__enableTestMedia = () => {
      window.__testMediaEnabled = true;
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!window.__testMediaEnabled) {
        throw new DOMException("Media unavailable for this test participant", "NotAllowedError");
      }
      return original(constraints);
    };
  });
  const guestTwo = await guestTwoContext.newPage();
  guestTwo.on("pageerror", (error) => consoleErrors.push(`guest2 pageerror: ${error.message}`));

  try {
    await test.step("host authenticates and joins with consent", async () => {
      await host.goto(`/meeting/${meeting.roomId}`);
      await expect(host.getByRole("button", { name: "Join meeting" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(host.getByText("Signed-in participant")).toBeVisible();
      await expect(host.getByRole("button", { name: "Join meeting" })).toBeDisabled();
      await host.locator("#consent").check();
      await host.getByRole("button", { name: "Join meeting" }).click();
      await expect(host.getByRole("button", { name: "Leave" })).toBeVisible({ timeout: 60_000 });
      await expect(host.locator("header").getByText("Live", { exact: true })).toBeVisible();
      await expect(host.locator("header").getByText("1 participant")).toBeVisible();
      await expectVideoCount(host, 1);
    });

    await test.step("guest joins as a room-scoped guest with camera and microphone", async () => {
      await guestOne.goto(`/meeting/${meeting.roomId}`);
      await joinGuest(guestOne, GUEST_ONE);
      await expect(host.locator("header").getByText("2 participants")).toBeVisible();
      await expect(guestOne.locator("header").getByText("2 participants")).toBeVisible();
      await expectVideoCount(host, 2);
      await expectVideoCount(guestOne, 2);
      await host.getByRole("button", { name: "Participants" }).click();
      await expect(host.getByRole("complementary").getByText(GUEST_ONE)).toBeVisible();
      await expect(
        host.getByRole("complementary").getByRole("img", { name: "Host" }),
      ).toBeVisible();
    });

    await test.step("text chat is delivered and attributed", async () => {
      const message = `Hello from the browser guest ${uniqueSuffix()}`;
      await guestOne.getByRole("button", { name: "Chat" }).click();
      await guestOne.getByLabel("Chat message").fill(message);
      await guestOne.getByRole("button", { name: "Send message" }).click();
      await host.getByRole("button", { name: "Chat" }).click();
      await expect(host.getByRole("complementary").getByText(message)).toBeVisible();
      await expect(
        host.getByRole("complementary").getByText(GUEST_ONE, { exact: true }),
      ).toBeVisible();
    });

    await test.step("camera-off participant joins receive-only, then enables media and renegotiates", async () => {
      await guestTwo.goto(`/meeting/${meeting.roomId}`);
      await joinGuest(guestTwo, GUEST_TWO);
      await expect(host.locator("header").getByText("3 participants")).toBeVisible();
      await expect(guestTwo.getByText(/No camera or microphone stream/)).toBeVisible();
      await expectVideoCount(guestTwo, 2, 90_000);
      await expectVideoCount(host, 2);

      await guestTwo.evaluate(() => window.__enableTestMedia());
      await guestTwo.getByRole("button", { name: "Enable" }).click();
      await expectVideoCount(guestTwo, 3, 90_000);
      await expectVideoCount(host, 3, 90_000);
      await expect(guestTwo.getByText(/No camera or microphone stream/)).toBeHidden({
        timeout: 30_000,
      });
    });

    await test.step("screen share remains visible when the camera is off", async () => {
      await host.getByRole("button", { name: "Turn camera off" }).click();
      await host.getByRole("button", { name: "Share screen" }).click();
      await expect(host.getByRole("button", { name: "Stop sharing screen" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(guestOne.getByText("Screen", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(guestTwo.getByText("Screen", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(host.getByRole("button", { name: "Stop sharing screen" })).toBeVisible();
      await host.getByRole("button", { name: "Stop sharing screen" }).click();
      await expect(guestOne.getByText("Screen", { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
      await host.getByRole("button", { name: "Turn camera on" }).click();
    });

    await test.step("recording is signalled to every participant, paused, resumed and saved locally", async () => {
      await host.bringToFront();
      await host.getByRole("button", { name: "Start local recording" }).click();
      await expect(host.getByRole("button", { name: "Stop recording" })).toBeVisible();
      await expect(host.locator("header").getByText("Recording", { exact: true })).toBeVisible();
      await expect(guestOne.locator("header").getByText("Recording", { exact: true })).toBeVisible();
      await expect(
        guestTwo.getByText(/recording this meeting locally/).first(),
      ).toBeVisible();

      // Let MediaRecorder emit its first timeslice before exercising pause/resume.
      await host.waitForTimeout(1800);
      await host.getByTitle("Pause recording").click();
      await guestOne.getByRole("button", { name: "Participants" }).click();
      await expect(guestOne.getByText("Recording paused", { exact: true })).toBeVisible();
      await host.getByTitle("Resume recording").click();
      await expect(guestOne.getByText(/^Recording$/).first()).toBeVisible();
      await guestOne.getByRole("button", { name: "Participants" }).click();

      await host.waitForTimeout(3500);
      await host.getByRole("button", { name: "Stop recording" }).click();
      await host.waitForTimeout(3000);
      await expect(host.getByText(/Recording saved locally/)).toBeVisible({ timeout: 60_000 });
      await expect(guestOne.locator("header").getByText("Recording", { exact: true })).toBeHidden({
        timeout: 30_000,
      });
      const recordings = await readLocalRecordings(host);
      expect(recordings.count).toBeGreaterThan(0);
      expect(Math.max(...recordings.sizes)).toBeGreaterThan(10_000);
    });

    await test.step("real microphone audio is transcribed locally with speaker attribution", async () => {
      await host.getByRole("button", { name: "Live transcript" }).click();
      await expect
        .poll(
          async () =>
            (await host.locator("main, body").innerText()).includes("reviewed the project timeline") ||
            (await host.locator("body").innerText()).includes("Priya will finish"),
          { timeout: 120_000, message: "browser speech never appeared in the live transcript" },
        )
        .toBe(true);
      await expect(host.getByText(/Live · \d+ speaker/)).toBeVisible();
    });

    await test.step("host ends the meeting and every participant is disconnected", async () => {
      await host.getByRole("button", { name: "Leave" }).click();
      await expect(host.getByRole("heading", { name: "Leave or end the meeting?" })).toBeVisible();
      await host.getByRole("button", { name: "End for everyone" }).click();
      await expect(host.getByRole("heading", { name: "Meeting ended" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(guestOne.getByRole("heading", { name: "Meeting ended" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(guestTwo.getByRole("heading", { name: "Meeting ended" })).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step("Ollama final summary appears in the ended screen and meeting details", async () => {
      await expect(host.getByText("Final", { exact: true })).toBeVisible({ timeout: 6 * 60_000 });
      await host.getByRole("link", { name: /Open full meeting details/ }).click();
      await expect(host).toHaveURL(new RegExp(`/meetings/${meeting.id}\\?tab=summary`));
      await expect(host.getByRole("heading", { name: "Executive summary" })).toBeVisible();
      await expect(host.getByText("final", { exact: true })).toBeVisible();
      await expect(host.getByRole("button", { name: /Key Points/ })).toBeVisible();
      await expect(host.getByRole("button", { name: /Action Items/ })).toBeVisible();
      await expect(host.getByText("undefined participants")).toHaveCount(0);

      await host.getByRole("button", { name: "Transcript" }).click();
      await expect(host.getByText(/reviewed the project timeline/i).first()).toBeVisible();

      await host.goto("/meetings");
      await expect(host.getByText(title)).toBeVisible();
    });

    if (consoleErrors.length > 0) {
      console.log("Browser page errors observed:", consoleErrors);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  }
});
