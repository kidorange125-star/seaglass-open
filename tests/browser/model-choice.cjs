// The chat's model menu stays inside the chat window, and the model (and web switch) you pick is saved on the server,
// so another device starts from the same choice. The mock server disables the model button, so this test makes the
// status call look like a real setup; nothing is sent to a model.
const { chromium, devices } = require("playwright");
const B = process.env.SEAGLASS_URL || "http://localhost:5173";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const put = (b) => fetch(B + "/api/agent/choice", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

(async () => {
  check((await put({ model: "gpt-5" })).status === 400, "an unknown model is refused");
  check((await put({ web: "no" })).status === 400, "the web switch must be true or false");
  await put({ model: "", web: true }); // start from the default

  const b = await chromium.launch();
  const errs = [];
  const device = async (opts) => {
    const ctx = await b.newContext(opts);
    await ctx.route("**/api/agent/status", async (route) => {
      const res = await route.fetch(); const j = await res.json();
      await route.fulfill({ response: res, json: { ...j, mock: false, mode: "key" } });
    });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(B + "/?assistant=1#/", { waitUntil: "networkidle" });
    await p.waitForSelector(".agent .ag-modelbtn:not(:disabled)");
    return [ctx, p];
  };

  // Device one: a desktop with the floating chat window.
  const [c1, p1] = await device({ viewport: { width: 1280, height: 860 } });
  check(/Sonnet/.test(await p1.locator(".ag-modelbtn").innerText()), "starts on the default model");
  await p1.locator(".ag-modelbtn").click();
  const pop = p1.locator(".ag-model-pop");
  await pop.waitFor();
  const [pb, ab] = [await pop.boundingBox(), await p1.locator(".agent").boundingBox()];
  check(pb.x >= ab.x - 1 && pb.x + pb.width <= ab.x + ab.width + 1, `the model menu fits inside the chat window (menu ${Math.round(pb.x)}..${Math.round(pb.x + pb.width)}, window ${Math.round(ab.x)}..${Math.round(ab.x + ab.width)})`);
  await pop.locator("button", { hasText: "Haiku" }).click();
  await p1.locator(".ag-modelbtn").click();
  await p1.locator(".ag-model-pop button", { hasText: "Search the web" }).click(); // web off
  await p1.waitForTimeout(400);
  const saved = await fetch(B + "/api/agent/status").then((r) => r.json());
  check(/haiku/.test(saved.choice?.model) && saved.choice?.web === false, `saved on the server (${JSON.stringify(saved.choice)})`);
  await c1.close();

  // Device two: a phone that has never picked anything.
  const [c2, p2] = await device({ ...devices["iPhone 14"] });
  check(/Haiku/.test(await p2.locator(".ag-modelbtn").innerText()), "another device starts on Haiku");
  await p2.locator(".ag-modelbtn").click();
  const sheet = p2.locator(".ag-model-pop"); await sheet.waitFor();
  const sb = await sheet.boundingBox();
  check(sb.x >= 0 && sb.x + sb.width <= 390, "on a phone it's a bottom sheet across the screen");
  check(!(await sheet.locator("button[role=switch]").getAttribute("aria-checked")).includes("true"), "and web search is off there too");
  await c2.close();

  await put({ model: "", web: true });
  check(!errs.length, `no page errors ${errs.join("; ")}`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
