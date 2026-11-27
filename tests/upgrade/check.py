# Upgrade test, part 2 (tests/upgrade/run.mjs): this version's app on the upgraded database. The old owner signs in
# and everything is still theirs.
import json, urllib.request, http.cookiejar, os, sys, tempfile
B = os.environ.get("SEAGLASS_URL", "http://localhost:5175")
d = json.load(open(os.environ.get("UPGRADE_FILE") or os.path.join(tempfile.gettempdir(), "seaglass-upgrade.json")))
o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def req(m, p, body=None, h=None, opener=o):
    r = urllib.request.Request(B + p, data=None if body is None else json.dumps(body).encode(), method=m, headers={"Content-Type": "application/json", **(h or {})})
    try:
        with opener.open(r, timeout=60) as x: return x.status, x.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:200])
check("the old owner signs in", req("POST", "/api/login", {"username": "old_owner", "password": "an old long password 1"})[0] == 200)
s, t = req("GET", "/api/session"); u = json.loads(t)["user"]
check("as the owner", u["role"] == "owner" and u["username"] == "old_owner", u)
s, t = req("GET", f"/api/notes/{d['note']}"); check("the old page opens", s == 200 and "UPGRADE words" in t, (s, t[:100]))
s, t = req("GET", "/api/tree"); check("the old page is listed", t.count("UPGRADE page") == 1, t[:200])
check("the household setting kept", "Upgrade House" in req("GET", "/api/session")[1])
check("saved permissions kept", '"add":"never"' in req("GET", "/api/agent/permissions")[1].replace(" ", ""))
check("saved prompt kept", "upgradeplan" in req("GET", "/api/prompts")[1])
check("memory kept", "UPGRADE memory" in req("GET", "/api/memories")[1])
check("study subject kept", "UPGRADE subject" in req("GET", "/api/study-overview?today=2026-01-15")[1])
check("the conversation kept", "UPGRADE" in req("GET", "/api/thread")[1])
anon = urllib.request.build_opener()
s, t = req("POST", "/api/capture", {"text": "UPGRADE captured after"}, {"Authorization": f"Bearer {d['token']}"}, opener=anon)
check("the old capture key still works", s == 201, (s, t))
check("...into the owner's things", "Inbox" in req("GET", "/api/tree")[1])
s, t = req("GET", f"/p/{d['slug']}", opener=anon); check("the old shared page is still public", s == 200 and "UPGRADE words" in t, s)
s, t = req("POST", "/api/household/invites", {"label": "New kid"}); check("the old owner can invite", s == 201, (s, t))
s, t = req("PUT", "/api/prompts", {"name": "upgradeplan2", "text": "x"}); check("a new prompt saves", s == 200, (s, t))
print(f"{ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
