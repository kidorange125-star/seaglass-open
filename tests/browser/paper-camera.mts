// Paper Lock with a live camera: Chromium's fake camera plays an MJPEG of a hand-drawn card, so the video, the card frame, the
// "card seen" check and the Scan button run for real. Local dev server on a wiped database.
//   SEAGLASS_URL=http://localhost:5174 node --experimental-strip-types tests/browser/paper-camera.mts
import { chromium } from "playwright";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullCard, scene } from "../helpers/paperCards.mts";

const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m: string, p: string, b?: unknown) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return (await r.json().catch(() => ({}))) as any; };

(async () => {
  const mine = fullCard(31), other = fullCard(32);
  // the fake camera's picture: the card lying on a darker table, a little turned (640 x 480 JPEG frames)
  const dir = mkdtempSync(join(tmpdir(), "paper-cam-"));
  const painter = await (await (await chromium.launch()).newContext()).newPage();
  // three positions of the card, two seconds each, looping: setting a card up takes three scans of the card MOVED
  const mjpeg = async (card: typeof mine, seed: number, file: string) => {
    const frames: Buffer[] = [];
    for (const [k, fill] of [[0, 0.5], [1, 0.62], [2, 0.72]] as const) {
      const { px, W, H } = scene(card, seed + k, { W: 640, H: 480, fill, turn: 8 });
      const b64 = await painter.evaluate(([data, w, h]) => {
        const c = document.createElement("canvas"); c.width = w as number; c.height = h as number;
        c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data as number[]), w as number, h as number), 0, 0);
        return c.toDataURL("image/jpeg", 0.92).split(",")[1];
      }, [Array.from(px), W, H] as const);
      const frame = Buffer.from(b64, "base64");
      for (let i = 0; i < 60; i++) frames.push(frame);
    }
    writeFileSync(file, Buffer.concat(frames));
  };
  const mineFile = join(dir, "mine.mjpeg"), otherFile = join(dir, "other.mjpeg");
  await mjpeg(mine, 5, mineFile); await mjpeg(other, 6, otherFile);

  const launch = (file: string) => chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${file}`] });
  const page = (await j("POST", "/api/notes", { title: "Camera page", html: "<p>secret via camera</p>" }));
  const errs: string[] = [];
  const run = async (file: string, fn: (p: import("playwright").Page) => Promise<void>) => {
    const b = await launch(file);
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA, permissions: ["camera"] });
    await ctx.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`${B}/?n=${Date.now()}#/p/${page.id}`, { waitUntil: "networkidle" });
    await fn(p); await b.close();
  };

  // ---- lock with the live camera showing the card: it finds the card, outlines it and takes the three scans by itself
  await run(mineFile, async (p) => {
    await p.locator(".ProseMirror").waitFor();
    await p.locator("button[title='Page options']").click();
    await p.getByRole("button", { name: /Lock with a paper card/ }).click();
    await p.getByRole("button", { name: "Make a new card" }).click();
    await p.getByRole("button", { name: /I've drawn it/ }).click();
    await p.locator(".cc video").waitFor();
    await p.waitForFunction(() => (document.querySelector(".cc video") as HTMLVideoElement | null)?.videoWidth ?? 0 > 0, null, { timeout: 10000 });
    check(true, "the full-screen camera shows the live picture");
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/cam-1-open.png` });
    await p.locator(".cc.found").waitFor({ timeout: 8000 });
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/cam-2-found.png` });
    const outline = await p.locator(".cc-overlay").evaluate((c: HTMLCanvasElement) => { const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let g = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 120 && d[i + 3] > 200) g++; return g; });
    check(outline > 200, `the card's edges are drawn in green on the picture (${outline} green pixels)`);
    await p.getByText(/move the card a little/i).waitFor({ timeout: 10000 });
    check(true, "after a scan it asks for the card to be moved before the next (no three scans of one frozen picture)");
    await p.locator(".pl-name").waitFor({ timeout: 30000 });
    check(await p.locator(".pl-thumbs img").count() === 3, "moved and held still, the card is scanned three times by itself");
    await p.getByRole("button", { name: "Lock this page" }).click();
    await p.getByText("The only way back in is your card").waitFor({ timeout: 10000 });
  });

  // ---- another card in front of the camera doesn't open it; the same card does
  await run(otherFile, async (p) => {
    await p.getByRole("button", { name: "Scan card to open" }).click();
    await p.getByText(/doesn't look like the card/).waitFor({ timeout: 12000 });
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/cam-3-wrong.png` });
    check(await p.locator(".ProseMirror").count() === 0, "a different drawing in front of the camera is refused");
  });
  await run(mineFile, async (p) => {
    await p.getByRole("button", { name: "Scan card to open" }).click();
    await p.locator(".ProseMirror").waitFor({ timeout: 15000 });
    check((await p.locator(".ProseMirror").innerText()).includes("secret via camera"), "the card in front of the camera opens the page by itself");
  });
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
