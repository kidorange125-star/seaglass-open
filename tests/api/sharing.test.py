# Sharing a page with one person (worker/sharing.ts): view or edit, the page and its sub-pages only, reached at
# /api/s/share/<id>/... Three real accounts with sessions. Run on an EMPTY database (no accounts), ANTHROPIC_API_KEY=mock,
# DEFAULT_AGENT_PERMISSIONS=free, no SETUP_CODE (AUTH_OPEN either way).
import os, json, uuid, urllib.request, urllib.error, http.cookiejar
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173")
MARK = "SHARED" + uuid.uuid4().hex[:8]
SECRET = "PRIVATE" + uuid.uuid4().hex[:8]
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

ana, bee, cat = Who(), Who(), Who()
ana("POST", "/api/setup", {"mode": "household", "household_name": "Share house", "display_name": "Ana", "username": "ana_share", "password": "a long test password 1"})
def join(who, name):
    code = (j(ana("POST", "/api/household/invites", {"role": "adult"})[1]) or {}).get("code")
    return ((j(who("POST", "/api/join", {"code": code, "display_name": name, "username": f"{name.lower()}_share", "password": "another long password 2"})[1]) or {}).get("user") or {}).get("id")
bee_id, cat_id = join(bee, "Bee"), join(cat, "Cat")
check("three people", bee_id and cat_id)

# ---- Ana's pages: a trip plan with a sub-page, and a private diary
s, t = ana("POST", "/api/upload", raw=PNG, ctype="image/png"); pic = (j(t) or {}).get("url", "")
trip = (j(ana("POST", "/api/notes", {"title": MARK + " Trip", "html": f'<p>plan</p><img src="{pic}">'})[1]) or {})["id"]
day1 = (j(ana("POST", "/api/notes", {"title": MARK + " Day 1", "parent_id": trip, "html": "<p>museum</p>"})[1]) or {})["id"]
diary = (j(ana("POST", "/api/notes", {"title": SECRET + " Diary", "html": "<p>secret</p>"})[1]) or {})["id"]
s, t = ana("POST", "/api/upload", raw=PNG, ctype="image/png"); diarypic = (j(t) or {}).get("url", "")
ana("PATCH", f"/api/notes/{diary}", {"html": f'<p>secret</p><img src="{diarypic}">', "revision": 1})

# ---- sharing
check("Ana shares the trip with Bee to edit", ana("PUT", f"/api/notes/{trip}/people/{bee_id}", {"level": "edit"})[0] == 200)
check("...and with Cat to view", ana("PUT", f"/api/notes/{trip}/people/{cat_id}", {"level": "view"})[0] == 200)
people = j(ana("GET", f"/api/notes/{trip}/people")[1]) or []
check("the page knows who it's shared with", sorted((p["display_name"], p["level"]) for p in people) == [("Bee", "edit"), ("Cat", "view")], people)
check("a level that isn't one is refused", ana("PUT", f"/api/notes/{trip}/people/{bee_id}", {"level": "own"})[0] == 400)
check("Bee can't share Ana's page", bee("PUT", f"/api/notes/{trip}/people/{cat_id}", {"level": "edit"})[0] == 404)
mine = j(bee("GET", "/api/shared-with-me")[1]) or []
check("Bee sees it under Shared with me", len(mine) == 1 and mine[0]["owner_name"] == "Ana" and mine[0]["level"] == "edit", mine)
sb = mine[0]["id"] if mine else ""
sc = ((j(cat("GET", "/api/shared-with-me")[1]) or [{}])[0]).get("id", "")
SB, SC = f"/api/s/share/{sb}", f"/api/s/share/{sc}"

# ---- what Bee can reach
info = j(bee("GET", f"{SB}/share-info")[1]) or {}
check("share info: whose and what level", info.get("owner_name") == "Ana" and info.get("level") == "edit" and info.get("root_id") == trip, info)
tree = j(bee("GET", f"{SB}/tree")[1]) or []
check("the page list is only the shared branch", sorted(n["id"] for n in tree) == sorted([trip, day1]), [n.get("title") for n in tree])
check("...with the shared page at the top", next((n for n in tree if n["id"] == trip), {}).get("parent_id") is None)
check("Bee opens the page and its sub-page", MARK in bee("GET", f"{SB}/notes/{trip}")[1] and "museum" in bee("GET", f"{SB}/notes/{day1}")[1])
check("Ana's diary can't be opened through the share", bee("GET", f"{SB}/notes/{diary}")[0] == 404)
check("...nor through Bee's own space", bee("GET", f"/api/notes/{diary}")[0] == 404)
for p in ("/search?q=" + SECRET, "/recent", "/home", "/trash", "/runs", "/export", "/thread", f"/notes/{trip}/backlinks"):
    s, t = bee("GET", SB + p)
    check(f"not through a share: {p.split('?')[0]}", s in (403, 404) and SECRET not in t, (s, t[:120]))
check("the assistant can't be reached through a share", bee("POST", f"{SB}/agent", {"message": "mock:create x", "history": []})[0] == 403)
check("importing through a share is refused", bee("POST", f"{SB}/import/pages", {"root": trip, "pages": [{"id": str(uuid.uuid4()), "parent_id": trip, "title": "x"}]})[0] == 403)
check("changes through a share say nothing", (j(bee("GET", f"{SB}/changes?since=1")[1]) or {}).get("changes") == [])

# ---- editing
rev = (j(bee("GET", f"{SB}/notes/{trip}")[1]) or {}).get("revision")
s, t = bee("PATCH", f"{SB}/notes/{trip}", {"html": f"<p>plan, and lunch</p><img src=\"{pic}\">", "revision": rev})
check("Bee (edit) changes the words", s == 200 and "lunch" in ana("GET", f"/api/notes/{trip}")[1], (s, t))
hist = j(ana("GET", f"/api/notes/{trip}/history")[1]) or []
check("Ana's history says Bee did it", any(h.get("agent") == "Bee" for h in hist), [h.get("agent") for h in hist])
rev = (j(bee("GET", f"{SB}/notes/{trip}")[1]) or {}).get("revision")
check("Bee can't move it out", bee("PATCH", f"{SB}/notes/{trip}", {"parent_id": None, "revision": rev})[0] == 403)
check("...or move a sub-page under Ana's diary", bee("PATCH", f"{SB}/notes/{day1}", {"parent_id": diary, "revision": 1})[0] == 403)
check("...or publish it", bee("POST", f"{SB}/notes/{trip}/share", {"enabled": True})[0] == 403)
check("...or trash it", bee("DELETE", f"{SB}/notes/{trip}")[0] == 403)
s, t = bee("POST", f"{SB}/notes", {"title": "Day 2", "parent_id": trip})
d2 = (j(t) or {}).get("id")
check("Bee adds a sub-page inside the shared page", s in (200, 201) and d2 in [n["id"] for n in j(ana("GET", "/api/tree")[1]) or []], (s, t))
check("...but not anywhere else of Ana's", bee("POST", f"{SB}/notes", {"title": "Sneaky", "parent_id": diary})[0] == 403 and bee("POST", f"{SB}/notes", {"title": "Top"})[0] == 403)
check("Bee comments", bee("POST", f"{SB}/notes/{trip}/comments", {"body": "Bring snacks"})[0] in (200, 201))
check("the picture on the shared page opens for Bee", bee("GET", pic)[0] == 200)
check("...the one on Ana's diary doesn't", bee("GET", diarypic)[0] == 404)

# ---- viewing only
page = j(cat("GET", f"{SC}/notes/{trip}")[1]) or {}
check("Cat (view) reads it, shown locked", "lunch" in json.dumps(page) and page.get("locked") == 1, page.get("locked"))
check("Cat's page list is locked too", all(n.get("locked") == 1 for n in j(cat("GET", f"{SC}/tree")[1]) or [{}]))
check("Cat can't edit", cat("PATCH", f"{SC}/notes/{trip}", {"html": "<p>x</p>", "revision": page.get("revision")})[0] == 403)
check("Cat can't add pages", cat("POST", f"{SC}/notes", {"title": "x", "parent_id": trip})[0] == 403)
check("Cat can't use Bee's share", cat("GET", f"{SB}/notes/{trip}")[0] == 404)

# ---- taking it back
check("Ana stops sharing with Cat", ana("DELETE", f"/api/notes/{trip}/people/{cat_id}")[0] == 200)
check("...Cat can't open it any more", cat("GET", f"{SC}/notes/{trip}")[0] == 404 and j(cat("GET", "/api/shared-with-me")[1]) == [])
check("trashing the page closes the share", ana("DELETE", f"/api/notes/{trip}")[0] == 204 and bee("GET", f"{SB}/notes/{trip}")[0] == 404 and j(bee("GET", "/api/shared-with-me")[1]) == [])
ana("POST", f"/api/notes/{trip}/restore")
check("...and restoring it opens it again", bee("GET", f"{SB}/notes/{trip}")[0] == 200)
check("removing Bee from the household removes the share", ana("DELETE", f"/api/household/members/{bee_id}", {"confirm": "bee_share"})[0] == 200 and j(ana("GET", f"/api/notes/{trip}/people")[1]) == [])
print(f"{ok} passed, {bad} failed")
