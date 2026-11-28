# 0.2: one person can't see or change another's things (worker/scope.ts). Two people on one test server, no invites
# needed: with AUTH_OPEN=1 the app answers as the FIRST account, or as the test user "dev" when there is none. So:
#   1. as "dev" (person A), put a unique marker in everything A can make;
#   2. add an account by SQL dated earliest, so the same server now answers as person B;
#   3. as B, every GET route (and the MCP tools) must come back without the marker, and naming A's ids directly must
#      read nothing and change nothing;
#   4. remove B's account: A's things must be exactly as they were.
# Run with .dev.vars ANTHROPIC_API_KEY=mock, AUTH_OPEN=1, DEFAULT_AGENT_PERMISSIONS=free, on an EMPTY database (no
# accounts). SEAGLASS_STATE: the --persist-to folder the test server uses (if any), so the account can be added by SQL.
import os, re, json, uuid, subprocess, datetime, urllib.request, urllib.error
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173")
STATE = os.environ.get("SEAGLASS_STATE", "")
MARK = "CANARY" + uuid.uuid4().hex[:10]
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:300])
def req(method, path, body=None, headers=None, raw=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as x: return x.status, x.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")
def j(t):
    try: return json.loads(t)
    except Exception: return None
def sql(command):
    args = ["npx", "wrangler", "d1", "execute", "seaglass", "--local", "--command", command] + (["--persist-to", STATE] if STATE else [])
    subprocess.run(args, check=True, capture_output=True, shell=os.name == "nt")
def mcp(tool, args):
    s, t = req("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}},
               {"Authorization": "Bearer test", "Accept": "application/json, text/event-stream"})
    return s, t

me = j(req("GET", "/api/session")[1]) or {}
check("starts as the test user (empty database)", (me.get("user") or {}).get("id") == "dev", me)

# ---------------------------------------------------------------- 1. A makes things
s, t = req("POST", "/api/notes", {"title": MARK + " page", "html": f"<p>{MARK} words</p>"}); a1 = (j(t) or {}).get("id")
s, t = req("POST", "/api/notes", {"title": MARK + " child", "parent_id": a1}); a2 = (j(t) or {}).get("id")
check("A made pages", a1 and a2, t)
slug = (j(req("POST", f"/api/notes/{a1}/share", {"enabled": True})[1]) or {}).get("share_slug")
s, t = req("POST", f"/api/notes/{a1}/comments", {"body": MARK + " comment"}); cid = (j(t) or {}).get("id")
req("POST", "/api/memories", {"text": MARK + " memory"})
req("PUT", "/api/prompts", {"name": "canary", "text": MARK + " prompt"})
s, t = req("PUT", "/api/routines", {"name": MARK + " routine", "prompt": MARK, "days": 127, "time": "08:00"}); rid = (j(t) or {}).get("id")
s, t = req("POST", "/api/study-subjects", {"name": MARK + " subject", "emoji": "🧪"}); sid = (j(t) or {}).get("id")
req("PUT", f"/api/study-pages/{a1}", {"subject_id": sid})
req("PUT", f"/api/study/{a1}/card1", {"ease": 2.5, "interval": 3, "reps": 2, "lapses": 0, "due": 1})
req("PUT", "/api/agent/permissions", {"add": "never"})
req("POST", "/api/agent", {"message": f"mock:create {MARK} agent page", "history": []})
tok = (j(req("POST", "/api/capture/token")[1]) or {}).get("token", "")
s, t = req("POST", "/api/capture", {"text": MARK + " captured"}, {"Authorization": f"Bearer {tok}"})
check("A's capture key works", s == 201, (s, t))
before = j(req("GET", f"/api/notes/{a1}")[1]) or {}
tree_before = j(req("GET", "/api/tree")[1]) or []
check("A sees the marker", MARK in json.dumps(before) and len(tree_before) >= 3, len(tree_before))

# ---------------------------------------------------------------- 2. B arrives
bid = str(uuid.uuid4())
sql(f"INSERT INTO users (id, username, display_name, pass_hash, pass_salt, pass_iter, role, created_at, password_changed_at) VALUES ('{bid}', 'canary_b', 'Bee', 'x', 'x', 1, 'adult', 0, 0)")
me = j(req("GET", "/api/session")[1]) or {}
check("now answering as B", (me.get("user") or {}).get("id") == bid, me)

# ---------------------------------------------------------------- 3. B looks everywhere
routes = set()
for f in os.listdir("src/worker"):
    if f.endswith(".ts"):
        routes |= set(re.findall(r'app\.get\("(/api/[^"]*)"', open(os.path.join("src/worker", f), encoding="utf-8").read()))
today = datetime.date.today().isoformat()
fill = {":id": a1, ":aid": "0", ":date": today, ":name": "x.sgb", "*": "x"}
seen = []
for r in sorted(routes):
    if r in ("/api/unfurl", "/api/voice/model/*"): continue
    p = r
    for k, v in fill.items(): p = p.replace(k, v)
    p += f"?today={today}&q={MARK}&since=1&tz=UTC"
    s, t = req("GET", p)
    if MARK in t: seen.append((r, s, t[:120]))
check(f"no GET route shows B any of A's things ({len(routes)} routes)", not seen, seen)
perm = j(req("GET", "/api/agent/permissions")[1]) or {}
check("B has their own assistant permissions", (perm.get("permissions") or {}).get("add") != "never", perm)
s, t = req("POST", "/api/search/meaning", {"q": MARK}); check("search by meaning finds nothing of A's", MARK not in t, t[:200])

for tool, args in [("search_notes", {"query": MARK}), ("list_pages", {}), ("read_note", {"id": a1}), ("read_notes", {"ids": [a1, a2]}),
                   ("list_recent_changes", {}), ("list_trashed", {}), ("search_past_chats", {"query": MARK}), ("study_overview", {}),
                   ("list_database_rows", {"database_id": a1}), ("flashcard_progress", {})]:
    s, t = mcp(tool, args)
    check(f"MCP {tool} shows nothing of A's", MARK not in t, t[:200])
s, t = mcp("update_note", {"id": a1, "title": "pwned by B"})
s, t = mcp("append_to_note", {"id": a1, "html": "<p>pwned by B</p>"})
s, t = mcp("delete_note", {"id": a1})

# Naming A's ids directly
writes = [
    ("PATCH", f"/api/notes/{a1}", {"title": "pwned by B", "revision": before.get("revision", 1)}),
    ("POST", f"/api/notes/{a1}/share", {"enabled": False}),
    ("POST", f"/api/notes/{a1}/ai-hidden", {"hidden": True}),
    ("POST", f"/api/notes/{a1}/duplicate", {}),
    ("POST", f"/api/notes/{a1}/comments", {"body": "pwned by B"}),
    ("PATCH", f"/api/comments/{cid}", {"body": "pwned by B"}),
    ("DELETE", f"/api/comments/{cid}", None),
    ("POST", "/api/notes", {"title": "B's child", "parent_id": a1}),
    ("PUT", f"/api/study-pages/{a1}", {"done": True}),
    ("PUT", f"/api/study/{a1}/card1", {"ease": 1.3, "interval": 0, "reps": 0, "lapses": 9, "due": 0}),
    ("PATCH", f"/api/study-subjects/{sid}", {"name": "pwned by B"}),
    ("PUT", "/api/routines", {"id": rid, "name": "pwned by B", "prompt": "x", "days": 127, "time": "08:00"}),
    ("DELETE", f"/api/routines/{rid}", None),
    ("POST", "/api/runs/undo", {}),
    ("POST", "/api/import", {"notes": [{"id": a1, "title": "pwned by B", "html": ""}]}),
    ("POST", "/api/import/pages", {"pages": [{"id": a1, "parent_id": None, "title": "pwned by B"}]}),
    ("POST", "/api/import/pages", {"pages": [{"id": str(uuid.uuid4()), "parent_id": a1, "title": "B's import"}]}),
    ("DELETE", f"/api/notes/{a1}", None),
    ("DELETE", f"/api/notes/{a1}/purge", None),
    ("DELETE", f"/api/study-subjects/{sid}", None),
]
for m, p, b in writes: req(m, p, b)
s, t = req("POST", "/api/capture", {"text": "B's capture"}, {"Authorization": f"Bearer {tok}"})
check("A's capture key still captures into A's things, not B's", MARK not in json.dumps(j(req("GET", "/api/tree")[1]) or []), t)
s, t = req("GET", f"/p/{slug}")
check("A's shared page is still public", s == 200 and MARK in t, s)

# ---------------------------------------------------------------- 4. B leaves; A is untouched
sql(f"DELETE FROM users WHERE id = '{bid}'")
me = j(req("GET", "/api/session")[1]) or {}
check("back to A", (me.get("user") or {}).get("id") == "dev", me)
after = j(req("GET", f"/api/notes/{a1}")[1]) or {}
check("A's page unchanged (title, words, revision, not trashed)",
      after.get("title") == before.get("title") and after.get("html") == before.get("html") and after.get("revision") == before.get("revision") and not after.get("deleted_at"),
      {k: (before.get(k), after.get(k)) for k in ("title", "revision", "deleted_at")})
check("A's page still shared and not hidden", after.get("share_slug") == slug and not after.get("ai_hidden"), after.get("share_slug"))
tree_after = j(req("GET", "/api/tree")[1]) or []
check("A's pages: none added, none gone", sorted(n["id"] for n in tree_after if "B's" not in (n.get("title") or "")) == sorted(n["id"] for n in tree_before) or len(tree_after) == len(tree_before) + 1,
      (len(tree_before), len(tree_after)))
check("nothing of B's landed in A's things", not any("pwned" in (n.get("title") or "") or "B's" in (n.get("title") or "") for n in tree_after), [n.get("title") for n in tree_after])
comments = req("GET", f"/api/notes/{a1}/comments")[1]
check("A's comment unchanged", MARK + " comment" in comments and "pwned" not in comments, comments[:200])
subj = req("GET", f"/api/study-overview?today={today}")[1]
check("A's study subject unchanged", MARK + " subject" in subj and "pwned" not in subj, subj[:200])
rts = req("GET", "/api/routines")[1]
check("A's routine unchanged", MARK + " routine" in rts and "pwned" not in rts, rts[:200])
study = req("GET", f"/api/study/{a1}")[1]
check("A's flashcard progress unchanged", '"lapses": 9' not in study.replace('":', '": ') , study[:200])
print(f"{ok} passed, {bad} failed")
