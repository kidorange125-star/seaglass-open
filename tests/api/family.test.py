# The shared Family space (src/shared/space.ts): pages, databases, tasks and the calendar everyone in a household
# shares, at /api/s/family/... Three real accounts with sessions. Run on an EMPTY database (no accounts) with .dev.vars
# ANTHROPIC_API_KEY=mock and DEFAULT_AGENT_PERMISSIONS=free (AUTH_OPEN either way), no SETUP_CODE.
import os, json, uuid, urllib.request, urllib.error, http.cookiejar
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173")
F = "/api/s/family"
MARK = "FAMILY" + uuid.uuid4().hex[:8]
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:300])
class Who:
    def __init__(self): self.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def __call__(self, method, path, body=None, raw=None, ctype="application/json"):
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
        r = urllib.request.Request(B + path, data=data, method=method, headers={"Content-Type": ctype})
        try:
            with self.o.open(r, timeout=60) as x: return x.status, x.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")
def j(t):
    try: return json.loads(t)
    except Exception: return None
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082")

ana, bee, kit, nobody = Who(), Who(), Who(), Who()
check("owner sets up a copy just for one person first", ana("POST", "/api/setup", {"mode": "individual", "display_name": "Ana", "username": "ana_fam", "password": "a long test password 1"})[0] in (200, 201))
check("no Family space for one person", ana("GET", f"{F}/tree")[0] == 403)
check("switching to a household", ana("PUT", "/api/household", {"mode": "household", "name": "The Fam"})[0] == 200)
def join(who, role, name):
    code = (j(ana("POST", "/api/household/invites", {"role": role, "label": name})[1]) or {}).get("code")
    return ((j(who("POST", "/api/join", {"code": code, "display_name": name, "username": f"{name.lower()}_fam", "password": "another long password 2"})[1]) or {}).get("user") or {}).get("id")
bee_id, kit_id = join(bee, "adult", "Bee"), join(kit, "kid", "Kit")
check("two more people joined", bee_id and kit_id)

# ---- a shared page
s, t = ana("POST", f"{F}/notes", {"title": MARK + " groceries", "html": "<p>milk</p>"}); fam = j(t) or {}
check("Ana makes a Family page", s in (200, 201) and fam.get("id"), (s, t))
check("Bee sees it in the Family space", MARK in bee("GET", f"{F}/tree")[1])
check("Kit (a kid) sees it too", MARK in kit("GET", f"{F}/tree")[1])
check("it isn't in anyone's own space", all(MARK not in w("GET", "/api/tree")[1] for w in (ana, bee, kit)))
rev = (j(bee("GET", f"{F}/notes/{fam['id']}")[1]) or {}).get("revision")
s, t = bee("PATCH", f"{F}/notes/{fam['id']}", {"html": "<p>milk, eggs</p>", "revision": rev})
check("Bee edits it", s == 200, (s, t))
check("Ana sees Bee's edit", "eggs" in ana("GET", f"{F}/notes/{fam['id']}")[1])
hist = j(ana("GET", f"{F}/notes/{fam['id']}/history")[1]) or []
check("history says who changed it", any(h.get("agent") == "Bee" for h in hist) and any(h.get("agent") == "Ana" for h in hist), [(h.get("agent"), h.get("tool")) for h in hist])
check("the Family page can't be opened through anyone's own space", ana("GET", f"/api/notes/{fam['id']}")[0] == 404)

# ---- a personal page never reaches the Family space
s, t = bee("POST", "/api/notes", {"title": "Bee's diary", "html": "<p>private</p>"}); diary = (j(t) or {}).get("id")
check("Bee's own page isn't in the Family space", "diary" not in ana("GET", f"{F}/tree")[1] and ana("GET", f"{F}/notes/{diary}")[0] == 404)
check("...and can't be moved into it", bee("PATCH", f"{F}/notes/{diary}", {"parent_id": fam["id"], "revision": 1})[0] == 404)
s, t = ana("POST", f"{F}/notes", {"title": "child", "parent_id": diary})
check("a Family page can't be put under someone's own page", s >= 400 or (j(t) or {}).get("parent_id") != diary, (s, t))

# ---- tasks and the calendar
s, t = ana("POST", f"{F}/tasks/ensure", {"today": "2026-11-27"}); tasks = j(t) or {}
check("the Family space gets its own tasks database", s == 200 and tasks.get("id"), (s, t))
check("...separate from Ana's own", tasks.get("id") != (j(ana("POST", "/api/tasks/ensure", {"today": "2026-11-27"})[1]) or {}).get("id"))
check("the Family calendar", ana("POST", f"{F}/calendar/ensure", {})[0] == 200)

# ---- only shared things work there
for m, p, b in [("POST", "/agent", {"message": "mock:create x", "history": []}), ("GET", "/memories", None), ("GET", "/study-overview?today=2026-11-27", None),
                ("GET", "/thread", None), ("POST", "/quick", {"text": "mock:create x"}), ("GET", "/export", None), ("POST", "/import", {"notes": []}),
                ("GET", "/usage", None), ("PUT", "/persona", {"persona": "jeff"}), ("POST", "/ai/selection", {"action": "fix", "html": "<p>x</p>"})]:
    check(f"not in the Family space: {m} {p.split('?')[0]}", ana(m, F + p, b)[0] == 403)
ev = [json.loads(l) for l in ana("POST", "/api/agent", {"message": f"mock:tool search_notes {{\"query\": \"{MARK}\"}}", "history": []})[1].splitlines() if l.strip().startswith("{")]
res = [e for e in ev if e["type"] == "tool_result"]
check("the assistant (personal) can't see Family pages", res and fam["id"] not in json.dumps(res) and not any(e.get("note_ids") for e in res), res)
# (With AUTH_OPEN=1 a request with no session counts as the first account, so this only means something without it.)
if not (j(nobody("GET", "/api/session")[1]) or {}).get("authed"): check("signed out, nothing", nobody("GET", f"{F}/tree")[0] == 401)

# ---- files
s, t = ana("POST", f"{F}/upload", raw=PNG, ctype="image/png"); ffile = (j(t) or {}).get("url", "")
check("a Family upload opens for everyone in the household", ffile and bee("GET", ffile)[0] == 200 and kit("GET", ffile)[0] == 200, (s, t))
s, t = ana("POST", "/api/upload", raw=PNG, ctype="image/png"); afile = (j(t) or {}).get("url", "")
check("...but Ana's own upload still doesn't", bee("GET", afile)[0] == 404)

# ---- undo works on the Family space's own changes
check("undo in the Family space", ana("POST", f"{F}/runs/undo", {})[0] == 200)

# ---- removing a member keeps the shared things
s, t = ana("DELETE", f"/api/household/members/{bee_id}", {"confirm": "bee_fam"})
check("Bee is removed", s == 200, (s, t))
check("the Family page Bee edited is still there", MARK in ana("GET", f"{F}/tree")[1])

# ---- back to one person: the Family space closes (nothing is deleted)
ana("DELETE", f"/api/household/members/{kit_id}", {"confirm": "kit_fam"})
check("back to just Ana", ana("PUT", "/api/household", {"mode": "individual"})[0] == 200)
check("the Family space is closed", ana("GET", f"{F}/tree")[0] == 403)
ana("PUT", "/api/household", {"mode": "household"})
check("...and comes back with its pages when it's a household again", MARK in ana("GET", f"{F}/tree")[1])
print(f"{ok} passed, {bad} failed")
