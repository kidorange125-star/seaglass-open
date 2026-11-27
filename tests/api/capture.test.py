# Quick capture (own revocable token), voice transcription, search by meaning. Same setup as sync.test.py
# (.dev.vars: ANTHROPIC_API_KEY=mock, API_TOKEN=test-token-123, PUBLIC_URL= blank; empty database). In mock mode
# embeddings are a word hash and transcription is canned, so nothing calls Workers AI. Run: python tests/api/capture.test.py
import os, json, time, urllib.request, urllib.error
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173"); TOKEN = "test-token-123"
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:500])
def req(method, path, body=None, token=TOKEN, ctype="application/json", raw=None):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if data is not None: h["Content-Type"] = ctype
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x:
            t = x.read().decode()
            return x.status, (json.loads(t) if t[:1] in ("{", "[") else t)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
def cron(ms=None):
    urllib.request.urlopen(f"{B}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time={ms or int(time.time() * 1000)}").read()

# ---- capture key
s, r = req("GET", "/api/capture/status"); check("capture off by default", s == 200 and r["enabled"] is False, r)
s, r = req("POST", "/api/capture", {"text": "hello"}, token="sgc_nope"); check("no key set -> 401", s == 401, (s, r))
s, r = req("POST", "/api/capture/token", {}); key = r.get("token", ""); check("make a key (shown once)", s == 200 and key.startswith("sgc_") and len(key) > 20, r)
s, r = req("GET", "/api/capture/status"); check("capture on", r["enabled"] is True)
s, r = req("POST", "/api/capture", {"text": "hello"}, token="sgc_wrong"); check("wrong key -> 401", s == 401, (s, r))
s, r = req("POST", "/api/capture", {"text": "hello"}, token=None); check("no auth at all -> 401", s == 401, (s, r))
s, r = req("GET", "/api/tree", token=key); check("the capture key opens nothing else", s == 401, (s, r))
s, r = req("POST", "/api/notes", {"title": "x"}, token=key); check("...not even creating pages", s == 401, (s, r))

# ---- capture: notes to the Inbox, tasks parsed
s, r = req("POST", "/api/capture", {"text": "Read chapter 4 for English", "today": "2026-11-07"}, token=key)
inbox = r.get("id"); check("a note goes to the Inbox page", s == 201 and r["kind"] == "note" and r["title"] == "Inbox", (s, r))
s, r = req("POST", "/api/capture", {"url": "https://example.com/a?b=1&c=2", "title": "Cool <article>"}, token=key)
check("a shared link goes to the same Inbox", s == 201 and r["id"] == inbox, r)
s, page = req("GET", f"/api/notes/{inbox}")
check("inbox has both lines, escaped", "Read chapter 4 for English" in page["html"] and 'href="https://example.com/a?b=1&amp;c=2"' in page["html"] and "&lt;article&gt;" in page["html"] and "<article>" not in page["html"], page["html"])
s, r = req("POST", "/api/capture", {"text": "task Call Sam tomorrow 3pm every mon", "today": "2026-11-07"}, token=key)
check("text starting with 'task' becomes a task", s == 201 and r["kind"] == "task" and r["due"] == "2026-11-08", r)
s, n = req("GET", f"/api/notes/{r['id']}"); props = json.loads(n["props"])
check("task: title, date, time, repeat parsed", n["title"] == "Call Sam" and props["due"] == {"start": "2026-11-08", "start_time": "15:00"} and props["repeat"] == "weekly" and props["status"] == "todo", (n["title"], props))
s, r = req("POST", "/api/capture", {"text": "buy milk", "type": "task", "today": "2026-11-07"}, token=key)
check("type=task forces a task (no date -> none)", r["kind"] == "task" and r["due"] is None, r)
s, r = req("POST", "/api/capture", raw=b"plain text from a shortcut", ctype="text/plain", token=key); check("plain text bodies work", s == 201 and r["kind"] == "note", (s, r))
s, r = req("POST", "/api/capture", {"text": ""}, token=key); check("empty -> 400", s == 400, (s, r))
req("DELETE", f"/api/notes/{inbox}")
s, r = req("POST", "/api/capture", {"text": "after trashing the inbox"}, token=key)
check("a trashed Inbox is replaced by a fresh one", s == 201 and r["id"] != inbox, r)
req("DELETE", "/api/capture/token")
s, r2 = req("POST", "/api/capture", {"text": "x"}, token=key)
check("revoking the key stops it", s == 401, (s, r2))
s, r = req("POST", "/api/capture", {"text": "from the app session"}, token=TOKEN); check("the master token can still capture", s == 201, (s, r))

# ---- voice transcription (mock)
audio = b"\x00" * 4000
s, r = req("POST", "/api/ai/transcribe", raw=audio, ctype="audio/webm;codecs=opus")
check("transcribe returns text + a saved recording", s == 200 and "mock" in r["text"] and r["url"].startswith("/files/") and r["url"].endswith(".webm"), (s, r))
f = urllib.request.Request(B + r["url"], headers={"Authorization": f"Bearer {TOKEN}"}); check("the recording is served back", len(urllib.request.urlopen(f).read()) == 4000)
s, r = req("POST", "/api/ai/transcribe", raw=audio, ctype="text/plain"); check("wrong type -> 415", s == 415, (s, r))
s, r = req("POST", "/api/ai/transcribe", raw=b"\x00" * 10, ctype="audio/mp4"); check("too-short recording -> 400", s == 400, (s, r))

# ---- search by meaning (mock embeddings = word hash)
mk = lambda t, h: req("POST", "/api/notes", {"title": t, "html": h})[1]["id"]
bio = mk("Photosynthesis", "<p>Plants convert sunlight water and carbon dioxide into glucose inside chloroplasts using chlorophyll.</p>")
civ = mk("Electoral College", "<p>The electoral college is how states elect the president, with electors voting after the popular election.</p>")
alg = mk("Linear equations", "<p>Solve linear equations by isolating the variable; slope intercept form is y equals mx plus b.</p>")
s, r = req("POST", "/api/search/meaning", {"query": "how do plants make glucose from sunlight"})
check("before indexing: nothing is searchable yet (and it says so)", s == 200 and r["indexed"] == 0 and r["pending"] >= 3, r)
cron(); time.sleep(1.5)
s, r = req("POST", "/api/search/meaning", {"query": "how do plants make glucose from sunlight"})
check("the cron indexes new notes", s == 200 and r["indexed"] >= 3 and r["pending"] == 0, r)
check("closest page first", r["hits"] and r["hits"][0]["id"] == bio and r["hits"][0]["title"] == "Photosynthesis", r["hits"][:2])
s, r = req("POST", "/api/search/meaning", {"query": "how do states elect the president"}); check("another question finds another page", r["hits"] and r["hits"][0]["id"] == civ, r["hits"][:2])
req("PATCH", f"/api/notes/{alg}", {"html": "<p>Mitochondria produce ATP by cellular respiration in the cell.</p>"})
s, r = req("POST", "/api/search/meaning", {"query": "cellular respiration ATP mitochondria"}); check("an edited page is pending until re-indexed", r["pending"] == 1, r)
cron(); time.sleep(1.5)
s, r = req("POST", "/api/search/meaning", {"query": "cellular respiration ATP mitochondria"}); check("...then found by its new content", r["hits"] and r["hits"][0]["id"] == alg and r["pending"] == 0, r)
req("DELETE", f"/api/notes/{civ}")
s, r = req("POST", "/api/search/meaning", {"query": "how do states elect the president"}); check("trashed pages drop out of results", all(h["id"] != civ for h in r["hits"]), r["hits"])
s, r = req("POST", "/api/search/meaning", {"query": "  "}); check("empty query -> 400", s == 400, (s, r))

# ---- Jeff and MCP can use it
s, t = req("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "search_by_meaning", "arguments": {"query": "plants glucose sunlight"}}})
res = json.loads(t["result"]["content"][0]["text"]); check("search_by_meaning tool over MCP", res["results"][0]["id"] == bio, res)
s, t = req("POST", "/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}); tools = t["result"]["tools"]; names = [x["name"] for x in tools]
check("tool is listed and read-only", "search_by_meaning" in names and next(x for x in tools if x["name"] == "search_by_meaning")["annotations"]["readOnlyHint"] is True, names)

print(f"\n{ok} passed, {bad} failed")
raise SystemExit(1 if bad else 0)
