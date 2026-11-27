// Paper Lock in the browser: a phone locks a page by drawing a card and scanning it, the page is then just a lock screen on
// every device, a computer asks and the phone's request screen answers it (green unlock, gone after 3 seconds, Relock, Deny),
// a closed page relocks at once. The camera isn't there in headless Chromium, so scans go through the full-screen camera's
// "photo of the card" path with synthetic phone photos of a hand-drawn card on a darker table (tests/helpers/paperCards.mts). Local dev server on a wiped database.
//   SEAGLASS_URL=http://localhost:5174 node --experimental-strip-types tests/browser/paper.mts
import { chromium, type Page } from "playwright";
import { fullCard, redraw, scene } from "../helpers/paperCards.mts";

const B = process.env.SEAGLASS_URL || "http://localhost:5173";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const j = async (m: string, p: string, b?: unknown) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
const WORDS = "the vault code is 4821";
const shot = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };

(async () => {
  const mine = fullCard(21), other = fullCard(22), copy = redraw(mine, 23, 0.05);
  const browser = await chromium.launch();

  // a JPEG of a card, as a camera would give it
  const painter = await (await browser.newContext()).newPage();
  const jpeg = async (card: typeof mine, seed: number) => {
    const { px, W, H } = scene(card, seed);
    const b64 = await painter.evaluate(([data, w, h]) => {
      const c = document.createElement("canvas"); c.width = w as number; c.height = h as number;
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data as number[]), w as number, h as number), 0, 0);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    }, [Array.from(px), W, H] as const);
    return { name: `card-${seed}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
  };
  const scanWith = async (p: Page, file: Awaited<ReturnType<typeof jpeg>>) => { await p.locator(".cc .cc-photo input").setInputFiles(file); };
  const camMsg = (p: Page) => p.locator(".cc-msg").innerText();

  const note = (await j("POST", "/api/notes", { title: "Diary", html: `<p>${WORDS}</p>` })).body;
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA });
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  for (const c of [phoneCtx, deskCtx]) await c.addInitScript(() => { localStorage.setItem("sg.agent", "0"); });
  const phone = await phoneCtx.newPage(), desk = await deskCtx.newPage();
  const errs: string[] = [];
  for (const p of [phone, desk]) p.on("pageerror", (e) => errs.push(e.message));

  // ---- a computer can't lock a page
  await desk.goto(`${B}/?n=${Date.now()}#/p/${note.id}`, { waitUntil: "networkidle" });
  await desk.locator(".ProseMirror").waitFor();
  await desk.locator("button[title='Page options']").click();
  await desk.getByRole("button", { name: /Lock with a paper card/ }).click();
  await desk.waitForTimeout(400);
  check(await desk.locator(".pl-setup").count() === 0 && /scanned on your phone/.test(await desk.locator("body").innerText()), "on a computer, Lock with a paper card says it's for the phone");

  // ---- the phone draws a card and locks the page
  await phone.goto(`${B}/?n=${Date.now()}#/p/${note.id}`, { waitUntil: "networkidle" });
  await phone.locator(".ProseMirror").waitFor();
  await phone.locator("button[title='Page options']").click();
  await phone.getByRole("button", { name: /Lock with a paper card/ }).click();
  await phone.locator(".pl-setup").waitFor();
  check(/no password and no reset/i.test(await phone.locator(".pl-setup").innerText()), "the lock dialog warns there's no reset");
  await shot(phone, "1-intro");
  await phone.getByRole("button", { name: "Make a new card" }).click();
  await phone.getByRole("button", { name: /I've drawn it/ }).click();
  await phone.locator(".cc").waitFor();
  check(await phone.locator(".cc-steps[aria-label='Scan 1 of 3']").count() === 1, "a full-screen camera asks for three scans");
  check(await phone.locator(".tabbar").isHidden(), "the phone's tab bar is hidden under the camera");
  await shot(phone, "2-scan");
  await scanWith(phone, await jpeg(mine, 1));
  await phone.locator(".cc-steps[aria-label='Scan 2 of 3']").waitFor();
  await scanWith(phone, await jpeg(mine, 2));
  await phone.locator(".cc-steps[aria-label='Scan 3 of 3']").waitFor();
  await scanWith(phone, await jpeg(mine, 3));
  await phone.locator(".pl-name").waitFor();
  check(await phone.locator(".cc").count() === 0 && await phone.locator(".pl-thumbs img").count() === 3, "after three scans the camera closes and asks for a name, showing the three scans");
  await shot(phone, "3-name");
  await phone.fill(".pl-name", "Blue fish");
  await phone.getByRole("button", { name: "Lock this page" }).click();
  await phone.getByText("The only way back in is your card").waitFor({ timeout: 10000 });
  check(true, "the page is locked");
  await shot(phone, "4-locked");
  await phone.getByRole("button", { name: "Done" }).click();

  // ---- locked: nothing of the page is on the screen or in the API
  await phone.locator(".pl-screen").waitFor();
  const phoneText = await phone.locator("body").innerText();
  check(/locked with a paper card/.test(phoneText) && !phoneText.includes("4821"), "the phone shows the lock screen, not the words");
  const row = (await j("GET", `/api/notes/${note.id}`)).body;
  check(row.html === "" && row.ai_hidden === 1 && row.paper_lock, "the server holds only a placeholder");

  // ---- the phone scans the wrong card, then the right one
  const clear = await phone.evaluate(() => { const b = [...document.querySelectorAll(".pl-screen button")].find((x) => /Scan card to open/.test(x.textContent ?? ""))!.getBoundingClientRect(), t = document.querySelector(".tabbar")?.getBoundingClientRect(); return !t || t.height === 0 || b.bottom <= t.top; });
  check(clear, "on the lock screen the tab bar doesn't cover the Scan button");
  await phone.getByRole("button", { name: "Scan card to open" }).click();
  await phone.locator(".cc").waitFor();
  await scanWith(phone, await jpeg(other, 11));
  await phone.getByText(/doesn't look like the card/).waitFor();
  check(/5 tries left/.test(await camMsg(phone)), "a wrong card is refused with the tries left");
  await scanWith(phone, await jpeg(copy, 13));
  await phone.getByText(/4 tries left/).waitFor();
  check(await phone.locator(".ProseMirror").count() === 0, "the same drawing copied by hand (5% off) is refused too");
  await scanWith(phone, await jpeg(mine, 12));
  await phone.locator(".ProseMirror").waitFor({ timeout: 10000 });
  check((await phone.locator(".ProseMirror").innerText()).includes("4821"), "the right card opens the page on the phone");
  check(/Paper-locked/.test(await phone.locator(".topbar .status").innerText()), "the page says it's paper-locked while open");

  // ---- the computer asks; the phone's request screen
  await desk.reload({ waitUntil: "networkidle" });
  await desk.locator(".pl-screen").waitFor();
  const deskText = await desk.locator("body").innerText();
  check(!deskText.includes("4821") && !deskText.includes("Diary"), "the computer shows no words and no title");
  await desk.getByRole("button", { name: "Ask my phone to unlock" }).click();
  await desk.getByText(/Waiting for your phone/).waitFor();
  await shot(desk, "5-desk-waiting");
  await phone.locator(".pl-sheet").waitFor({ timeout: 12000 });
  const sheet = await phone.locator(".pl-sheet").innerText();
  check(/Unlock request/.test(sheet) && /Windows computer/.test(sheet) && /Blue fish/.test(sheet), "the phone pops up who is asking and which card");
  check(!sheet.includes("Diary") && !sheet.includes("4821"), "and never the page's title or words");
  await shot(phone, "6-phone-request");
  check(await phone.locator(".tabbar").isHidden(), "the tab bar is hidden under the unlock request");
  await phone.getByRole("button", { name: "Scan card to allow" }).click();
  await phone.locator(".cc").waitFor();
  await scanWith(phone, await jpeg(other, 21));
  await phone.getByText(/doesn't look like the card/).waitFor();
  check(await desk.locator(".pl-screen").count() === 1 && await desk.locator(".ProseMirror").count() === 0, "a wrong card on the phone opens nothing");
  await scanWith(phone, await jpeg(mine, 22));
  await phone.locator(".pl-sheet.st-ok").waitFor();
  const unlockedAt = Date.now();
  await phone.waitForTimeout(900); await shot(phone, "7-phone-unlocked");
  check(await phone.locator(".pl-lock.open").count() === 1 && /Unlocked/.test(await phone.locator(".pl-sheet h2").innerText()), "the lock turns green and opens on the phone");
  check(await phone.getByRole("button", { name: /Relock/ }).isVisible(), "there's a Relock button at the bottom");
  await desk.locator(".ProseMirror").waitFor({ timeout: 10000 });
  check((await desk.locator(".ProseMirror").innerText()).includes("4821"), "the computer opens the page");
  await phone.locator(".pl-sheet").waitFor({ state: "detached", timeout: 6000 });
  const gone = Date.now() - unlockedAt;
  check(gone > 2700 && gone < 4300, `the phone's screen goes away about 3 seconds after unlocking (${gone} ms)`);

  // ---- editing on the computer saves through the lock, never into the page row
  await desk.locator(".ProseMirror p").first().click();
  await desk.keyboard.press("End"); await desk.keyboard.type(" and the second code is 77");
  await desk.waitForTimeout(1600);
  const afterEdit = await j("GET", `/api/notes/${note.id}`);
  check(afterEdit.body.html === "" && afterEdit.body.text === "" && afterEdit.body.title === "Paper-locked page" && !JSON.stringify(afterEdit.body).includes("second code"), "an edit made while open isn't written into the page row");

  // ---- leaving the page relocks it at once
  const open1 = (await j("GET", "/api/paper/grants")).body.grants;
  check(open1.length >= 1, "the server lists what is open");
  await desk.evaluate(() => { location.hash = "#/"; });
  await desk.waitForTimeout(2800);
  const open2 = (await j("GET", "/api/paper/grants")).body.grants;
  check(!open2.some((g: any) => /Windows/.test(g.device)), `leaving the page relocks it at once (still open: ${JSON.stringify(open2.map((g: any) => g.device))})`);

  // ---- the computer asks again; the phone's list can relock it while it's open
  await desk.goto(`${B}/?n=${Date.now()}#/p/${note.id}`, { waitUntil: "networkidle" });
  await desk.getByRole("button", { name: "Ask my phone to unlock" }).click();
  await phone.locator(".pl-sheet").waitFor({ timeout: 12000 });
  await phone.getByRole("button", { name: "Scan card to allow" }).click();
  await scanWith(phone, await jpeg(mine, 31));
  await phone.locator(".pl-sheet.st-ok").waitFor();
  await desk.locator(".ProseMirror").waitFor({ timeout: 10000 });
  check((await desk.locator(".ProseMirror").innerText()).includes("77"), "what was typed was kept");
  await phone.locator(".pl-sheet").waitFor({ state: "detached", timeout: 6000 });
  await phone.evaluate(() => dispatchEvent(new CustomEvent("seaglass:paper-manage")));
  await phone.locator(".pl-manage").waitFor();
  await phone.locator(".pl-manage .pl-list li", { hasText: "Windows" }).getByRole("button", { name: "Relock" }).click();
  await desk.locator(".pl-screen").waitFor({ timeout: 9000 });
  check(!(await desk.locator("body").innerText()).includes("4821"), "Relock in the phone's list locks the computer again within seconds, the words gone from its screen");
  await phone.keyboard.press("Escape");

  // ---- Relock on the unlock screen itself, in the 3 seconds
  await desk.getByRole("button", { name: "Ask my phone to unlock" }).click();
  await phone.locator(".pl-sheet").waitFor({ timeout: 12000 });
  await phone.getByRole("button", { name: "Scan card to allow" }).click();
  await scanWith(phone, await jpeg(mine, 41));
  await phone.locator(".pl-sheet.st-ok").waitFor();
  await phone.getByRole("button", { name: /Relock/ }).click();
  await phone.getByText("Locked again").waitFor();
  check(await phone.locator(".pl-lock.open").count() === 0, "Relock on the unlock screen closes the lock on the phone");
  await desk.waitForTimeout(4500);
  check(!(await desk.locator("body").innerText()).includes("4821"), "and the computer never shows the words");
  await phone.locator(".pl-sheet").waitFor({ state: "detached", timeout: 4000 });

  // ---- deny
  await desk.getByRole("button", { name: "Ask my phone to unlock" }).click();
  await phone.locator(".pl-sheet").waitFor({ timeout: 12000 });
  await phone.getByRole("button", { name: /Not me/ }).click();
  await desk.getByText("Your phone said no.").waitFor({ timeout: 6000 });
  check(true, "denying on the phone tells the computer");

  // ---- cancelling on the computer takes the request off the phone
  await desk.getByRole("button", { name: "Ask my phone to unlock" }).click();
  await phone.locator(".pl-sheet").waitFor({ timeout: 12000 });
  await desk.getByRole("button", { name: "Cancel" }).click();
  await phone.locator(".pl-sheet").waitFor({ state: "detached", timeout: 8000 });
  check(true, "cancelling on the computer removes the request from the phone");

  // ---- the phone's Paper Lock list
  await phone.goto(`${B}/?n=${Date.now()}#/`, { waitUntil: "networkidle" });
  await phone.evaluate(() => dispatchEvent(new CustomEvent("seaglass:paper-manage")));
  await phone.locator(".pl-manage").waitFor();
  await phone.getByText("Locks 1 page").waitFor();
  await shot(phone, "8-manage");
  check(/Blue fish/.test(await phone.locator(".pl-manage").innerText()) && /Locks 1 page/.test(await phone.locator(".pl-manage").innerText()), "the card list shows the card and its page");
  check(await phone.getByRole("button", { name: "Delete" }).isDisabled(), "a card that locks a page can't be deleted");

  // ---- search can't find it
  const hits = (await j("GET", "/api/search?q=vault")).body;
  check(!JSON.stringify(hits).includes(note.id), "search can't find the words");
  check(!errs.length, `no page errors ${errs.join(" | ")}`);

  await browser.close();
  console.log(fails ? `${fails} failed` : "all good");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
