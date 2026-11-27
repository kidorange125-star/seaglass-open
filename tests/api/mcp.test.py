import os, json, urllib.request, urllib.error, urllib.parse, http.cookiejar, base64, hashlib, secrets, re
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173"); TOKEN = "test-token-123"
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, x)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(jar))
def req(method, path, body=None, headers=None, form=None):
    h = dict(headers or {})
    data = None
    if form is not None: data = urllib.parse.urlencode(form, doseq=True).encode(); h["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None: data = json.dumps(body).encode(); h.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(path if path.startswith("http") else B + path, data=data, method=method, headers=h)
    try:
        with opener.open(r) as x: return x.status, {k.lower(): v for k, v in x.headers.items()}, x.read().decode()
    except urllib.error.HTTPError as e: return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode()
def browser_cookies(h):
    extra = h.get("set-cookie", "").split(";")[0]
    return {"Cookie": "; ".join([f"{c.name}={c.value}" for c in jar] + ([extra] if extra else []))}
def rpc(method, params=None, token=TOKEN, id=1):
    s, h, t = req("POST", "/mcp", {"jsonrpc": "2.0", "id": id, "method": method, "params": params or {}}, {"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream"})
    return s, (json.loads(t) if t else None)
def tool(name, args=None):
    s, r = rpc("tools/call", {"name": name, "arguments": args or {}})
    return r["result"]

# --- auth + discovery
s, h, t = req("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "ping"})
www = h.get("www-authenticate", "")
check("no auth -> 401 with resource metadata pointer", s == 401 and "resource_metadata" in www, (s, www))
check("wrong bearer -> 401", rpc("ping", token="nope")[0] == 401)
m = re.search(r'resource_metadata="([^"]+)"', www)
s, h, t = req("GET", m.group(1) if m else "/.well-known/oauth-protected-resource")
prm = json.loads(t) if s == 200 else {}
check("protected resource metadata", s == 200 and prm.get("resource", "").endswith("/mcp"), (s, t[:200]))
s, h, t = req("GET", "/.well-known/oauth-authorization-server")
asm = json.loads(t) if s == 200 else {}
check("authorization server metadata (DCR + PKCE S256)", s == 200 and asm.get("registration_endpoint", "").endswith("/oauth/register") and "S256" in asm.get("code_challenge_methods_supported", []), t[:300])

# --- protocol with the API token (Claude Code style)
s, r = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
check("initialize negotiates version + has instructions", s == 200 and r["result"]["protocolVersion"] == "2025-06-18" and "Page format" in r["result"]["instructions"], r)
s, h, t = req("POST", "/mcp", {"jsonrpc": "2.0", "method": "notifications/initialized"}, {"Authorization": f"Bearer {TOKEN}"})
check("notification -> 202", s == 202, s)
s, r = rpc("tools/list"); names = [x["name"] for x in r["result"]["tools"]]
check("tools/list has notes tools + undo/redo + study", "create_note" in names and "undo_last_change" in names and "manage_subject" in names and {"study_results", "study_session", "flashcard_progress"} <= set(names), names)
ro = {x["name"]: x["annotations"]["readOnlyHint"] for x in r["result"]["tools"]}
check("read-only annotations", ro["search_notes"] and not ro["create_note"])
c = tool("create_note", {"title": "From Claude", "html": "<p>Hello from MCP</p>"}); new_id = json.loads(c["content"][0]["text"])["id"]
check("create_note via MCP", not c.get("isError"), c)
check("search finds it", "From Claude" in tool("search_notes", {"query": "Claude"})["content"][0]["text"])
r2 = tool("read_note", {"id": new_id}); check("read_note", "Hello from MCP" in r2["content"][0]["text"])
check("bad id -> isError result (not a crash)", tool("read_note", {"id": "x"}).get("isError") is True)
ch = json.loads(tool("list_recent_changes")["content"][0]["text"]); check("recent changes shows Claude", ch[0]["by"] == "Claude", ch[:1])
AUTH = {"Authorization": f"Bearer {TOKEN}"}
hist = lambda nid, hd=AUTH: json.loads(req("GET", f"/api/notes/{nid}/history", headers=hd)[2])
check("history names the app (access token: its User-Agent)", hist(new_id)[0].get("agent") == "Python-urllib (MCP, access token)", hist(new_id)[:1])
check("recent changes list the agents too", ch[0].get("agents") == ["Python-urllib (MCP, access token)"], ch[:1])
u = tool("undo_last_change"); check("undo_last_change", not u.get("isError") and '"changed":1' in u["content"][0]["text"], u)
hu = hist(new_id)[0]; check("the undo says which agent asked for it (source stays user)", hu["tool"] == "undo" and hu["source"] == "user" and hu.get("agent") == "Python-urllib (MCP, access token)", hu)
s, r = rpc("tools/call", {"name": "list_recent_changes", "arguments": {"limit": 5}})
feed = json.loads(r["result"]["content"][0]["text"])["changes"]
check("the change feed names the agent", any(c.get("agent") == "Python-urllib (MCP, access token)" and c["page_id"] == new_id for c in feed), feed[-2:])
s, h, t = req("GET", f"/api/notes/{new_id}", headers={"Authorization": f"Bearer {TOKEN}"}); check("undone page is gone (trashed)", s == 404)
check("redo_last_change brings it back", not tool("redo_last_change").get("isError") and req("GET", f"/api/notes/{new_id}", headers={"Authorization": f"Bearer {TOKEN}"})[0] == 200)
s, r = rpc("nope/method"); check("unknown method -> -32601", r["error"]["code"] == -32601)
s, r = rpc("tools/call", {"name": "launch", "arguments": {}}); check("unknown tool -> -32602", r["error"]["code"] == -32602)
s, h, t = req("POST", "/mcp", None, {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}) if False else (None, None, None)
r = urllib.request.Request(B + "/mcp", data=b"{bad", method="POST", headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
try: opener.open(r); code = 200
except urllib.error.HTTPError as e: code = e.code; body = json.loads(e.read())
check("bad JSON -> parse error", code == 400 and body["error"]["code"] == -32700)
check("GET /mcp -> 405", req("GET", "/mcp", headers={"Authorization": f"Bearer {TOKEN}"})[0] == 405)

# --- full OAuth flow, like claude.ai / Claude Desktop
s, h, t = req("POST", "/oauth/register", {"client_name": "Test Claude", "redirect_uris": ["https://claude.example/cb"], "token_endpoint_auth_method": "none", "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]})
client = json.loads(t) if s in (200, 201) else {}
check("dynamic client registration", "client_id" in client, (s, t[:200]))
verifier = secrets.token_urlsafe(48); challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
q = urllib.parse.urlencode({"response_type": "code", "client_id": client.get("client_id", ""), "redirect_uri": "https://claude.example/cb", "code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz", "scope": "notes", "resource": prm.get("resource", B + "/mcp")})
s, h, t = req("GET", "/authorize?" + q)
check("not signed in -> sign-in page", s == 200 and "Sign in to connect" in t, (s, t[:200]))
s, h, t = req("POST", "/authorize/sign-in", form={"next": "/authorize?" + q, "token": "wrong"})
check("wrong token rejected on sign-in", s == 401)
s, h, t = req("POST", "/authorize/sign-in", form={"next": "https://evil.example/", "token": TOKEN})
check("sign-in never redirects off-site", s == 302 and h.get("location", "").startswith("/authorize"), h.get("location"))
s, h, t = req("POST", "/authorize/sign-in", form={"next": "/authorize?" + q, "token": TOKEN})
check("sign-in sets session and returns to /authorize", s == 302 and h.get("location", "").startswith("/authorize?"))
s, h, t = req("GET", "/authorize?" + q)
handle = re.search(r'name="handle" value="([^"]+)"', t); consent_h = h
check("consent page names the app and the redirect host", s == 200 and "Test Claude" in t and "claude.example" in t and handle, (s, t[:300]))
check("consent page can't be framed", "frame-ancestors" in (h.get("content-security-policy") or "") or h.get("x-frame-options"), {k: v for k, v in h.items() if "rame" in k or "Security" in k})
s, h, t = req("POST", "/authorize", form={"handle": handle.group(1) if handle else "", "decision": "approve"}, headers=browser_cookies(consent_h))
loc = h.get("location", ""); code = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query).get("code", [""])[0]
check("approve -> redirect with code + state", s == 302 and loc.startswith("https://claude.example/cb") and code and "state=xyz" in loc, loc[:120])
s, h, t = req("POST", "/oauth/token", form={"grant_type": "authorization_code", "code": code, "redirect_uri": "https://claude.example/cb", "client_id": client.get("client_id", ""), "code_verifier": verifier, "resource": prm.get("resource", "")})
tok = json.loads(t) if s == 200 else {}
check("token exchange with PKCE", s == 200 and tok.get("access_token"), (s, t[:200]))
s, r = rpc("tools/list", token=tok.get("access_token", "x"))
check("OAuth access token works on /mcp", s == 200 and any(x["name"] == "study_results" for x in r["result"]["tools"]))
s, r = rpc("tools/call", {"name": "create_note", "arguments": {"title": "Via OAuth", "html": "<p>x</p>"}}, token=tok.get("access_token", "x"))
oid = json.loads(r["result"]["content"][0]["text"])["id"] if s == 200 and not r["result"].get("isError") else None
check("an OAuth app's edits carry its registered name", oid and hist(oid)[0].get("agent") == "Test Claude (MCP)", oid and hist(oid)[:1])
s, h, t = req("POST", "/oauth/token", form={"grant_type": "authorization_code", "code": code, "redirect_uri": "https://claude.example/cb", "client_id": client.get("client_id", ""), "code_verifier": verifier})
check("authorization code can't be reused", s != 200)
# deny path
s, h, t = req("GET", "/authorize?" + q.replace("state=xyz", "state=d1"))
handle = re.search(r'name="handle" value="([^"]+)"', t); consent_h = h
s, h, t = req("POST", "/authorize", form={"handle": handle.group(1) if handle else "", "decision": "deny"}, headers=browser_cookies(consent_h))
check("deny -> access_denied back to the client", s == 302 and "error=access_denied" in h.get("location", ""), h.get("location"))
s, h, t = req("GET", "/authorize?" + q.replace("state=xyz", "state=f1"))
handle = re.search(r'name="handle" value="([^"]+)"', t)
s, h, t = req("POST", "/authorize", form={"handle": handle.group(1) if handle else "", "decision": "approve"})
check("consent POST without the browser binding cookie is refused (anti-CSRF)", s == 400 and "not started in this browser" in t)
# --- Study details for outside assistants
def out(res): return json.loads(res["content"][0]["text"])
def api(method, path, body=None):
    s, h, t = req(method, path, body, {"Authorization": f"Bearer {TOKEN}"})
    return s, (json.loads(t) if t else None)
s, r = rpc("tools/list"); listed = {x["name"]: x for x in r["result"]["tools"]}
check("study tools are marked read-only", all(listed[n]["annotations"]["readOnlyHint"] for n in ["study_overview", "study_results", "study_session", "flashcard_progress", "grades_overview"]))
s, r = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
check("the instructions tell a client what it can see", "study_results" in r["result"]["instructions"] and "flashcard_progress" in r["result"]["instructions"])
pg = out(tool("create_note", {"title": "Study page", "html": "<details><summary>What is osmosis?</summary><div data-type=\"detailsContent\"><p>Water moving</p></div></details><p>Mitosis :: cell division</p>"}))
pid = pg["id"]
sub = out(tool("manage_subject", {"action": "create", "name": "MCP Biology"}))
out(tool("manage_exam", {"action": "create", "subject": "MCP Biology", "name": "MCP unit test", "exam_date": "2030-01-10", "pages": [pid]}))
played = [{"type": "mcq", "q": "Where?", "answer": "Chloroplast", "right": False, "yours": "Nucleus", "options": ["Chloroplast", "Nucleus"], "correct": 0, "why": "That's where light is captured"}, {"type": "mcq", "q": "What gas?", "answer": "CO2", "right": True, "yours": "CO2", "options": ["CO2", "O2"], "correct": 0}]
s, b = api("POST", "/api/study/session", {"coach": False, "session": {"mode": "quiz", "ids": [pid], "title": "Study page", "right": 1, "total": 2, "missed": [{"q": "Where?", "a": "Chloroplast", "yours": "Nucleus"}], "seconds": 125, "played": played}})
check("a session with its time is saved", s == 200, (s, b))
api("POST", "/api/study/session", {"coach": False, "session": {"mode": "cards", "ids": [pid], "title": "Study page", "right": 3, "total": 4, "missed": [{"q": "Where?", "a": "Chloroplast"}]}})
rep = out(tool("study_results", {"days": 1}))
quiz = next(x for x in rep["sessions"] if x["mode"] == "quiz")
check("sessions give the score and misses", quiz["percent"] == 50 and quiz["missed"][0]["yours"] == "Nucleus", quiz)
check("and the pages by name", quiz["pages"][0]["title"] == "Study page", quiz)
check("and when and how long", quiz["seconds"] == 125 and quiz["finished_at"].endswith("Z") and quiz["started_at"] < quiz["finished_at"] and quiz["local_time"], quiz)
check("an old session says it has no time", next(x for x in rep["sessions"] if x["mode"] == "cards")["seconds"] is None)
check("totals by way of studying and by day", {x["mode"] for x in rep["summary"]["by_mode"]} >= {"quiz", "cards"} and rep["summary"]["seconds"] >= 125 and rep["summary"]["by_day"], rep["summary"])
check("what the user misses most", rep["summary"]["most_missed"][0] == {"question": "Where?", "answer": "Chloroplast", "times": 2}, rep["summary"]["most_missed"])
check("filter by way of studying", all(x["mode"] == "cards" for x in out(tool("study_results", {"days": 1, "mode": "cards"}))["sessions"]))
check("filter by test", len(out(tool("study_results", {"days": 1, "exam": "MCP unit test"}))["sessions"]) == 2)
check("filter by subject", len(out(tool("study_results", {"days": 1, "subject": "MCP Biology"}))["sessions"]) == 2)
check("limit caps the list, not the totals", (lambda r: len(r["sessions"]) == 1 and r["summary"]["sessions"] >= 2)(out(tool("study_results", {"days": 1, "limit": 1}))))
one = out(tool("study_session", {"session_id": quiz["session_id"]}))
check("study_session has every question", len(one["questions"]) == 2 and one["questions"][0]["question"] == "Where?" and one["questions"][0]["his_answer"] == "Nucleus" and one["questions"][0]["correct_answer"] == "Chloroplast" and one["questions"][0]["options"] == ["Chloroplast", "Nucleus"] and one["questions"][0]["why"], one)
check("flashcard sessions have no question list", out(tool("study_session", {"session_id": next(x for x in rep["sessions"] if x["mode"] == "cards")["session_id"]}))["questions"] is None)
check("an unknown session is an error", tool("study_session", {"session_id": "nope"}).get("isError") is True)
def card_id(q):
    h = 0x811c9dc5
    for ch in " ".join(q.strip().lower().split()):
        h ^= ord(ch); h = (h * 0x01000193) & 0xffffffff
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"; o = ""
    while h: o = digits[h % 36] + o; h //= 36
    return o or "0"
s, b = api("PUT", f"/api/study/{pid}/{card_id('What is osmosis?')}", {"ease": 2.1, "interval": 3, "reps": 4, "lapses": 2, "due": "2020-01-01"})
check("a flashcard review is saved", s == 200, (s, b))
fc = out(tool("flashcard_progress", {"page_ids": [pid]}))["pages"][0]
hard = fc["flashcards"][0]
check("flashcard_progress lists each card", fc["cards"] == 2 and fc["new"] == 1 and fc["due"] == 1, fc)
check("with its schedule and lapses, hardest first", hard["question"] == "What is osmosis?" and hard["lapses"] == 2 and hard["reviews"] == 4 and hard["interval_days"] == 3 and hard["is_due"] and hard["status"] == "learning", hard)
check("a card never reviewed is new", fc["flashcards"][1]["status"] == "new" and fc["flashcards"][1]["question"] == "Mitosis", fc["flashcards"][1])
check("no page ids means every page reviewed", any(p["page_id"] == pid for p in out(tool("flashcard_progress"))["pages"]))

print(f"\n{ok} passed, {bad} failed")
