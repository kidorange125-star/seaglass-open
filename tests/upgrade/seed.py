# Upgrade test, part 1 (tests/upgrade/run.mjs): make real data with the OLD release's app. Saves what part 2 checks.
import json, urllib.request, http.cookiejar, os, sys, tempfile
B = os.environ.get("SEAGLASS_URL", "http://localhost:5175")
o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def req(m, p, body=None):
    r = urllib.request.Request(B + p, data=None if body is None else json.dumps(body).encode(), method=m, headers={"Content-Type": "application/json"})
    try:
        with o.open(r, timeout=60) as x:
            t = x.read()
            try: return x.status, json.loads(t or b"null")
            except ValueError: return x.status, t.decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]
st = req("POST", "/api/setup", {"mode": "household", "household_name": "Upgrade House", "display_name": "Old Owner", "username": "old_owner", "password": "an old long password 1"})
if st[0] == 409: st = req("POST", "/api/login", {"username": "old_owner", "password": "an old long password 1"})
print(st)
s, n = req("POST", "/api/notes", {"title": "UPGRADE page", "html": "<p>UPGRADE words</p>"})
s2, sub = req("POST", "/api/study-subjects", {"name": "UPGRADE subject", "emoji": "📘"})
req("PUT", f"/api/study/{n['id']}/card1", {"ease": 2.5, "interval": 3, "reps": 2, "lapses": 1, "due": 1})
req("POST", "/api/memories", {"text": "UPGRADE memory"})
req("PUT", "/api/prompts", {"name": "upgradeplan", "text": "UPGRADE prompt"})
req("PUT", "/api/agent/permissions", {"add": "never"})
req("POST", "/api/agent", {"message": "mock:create UPGRADE agent page", "history": []})
s3, tok = req("POST", "/api/capture/token")
s4, share = req("POST", f"/api/notes/{n['id']}/share", {"enabled": True})
print(s, s2, s3, s4)
json.dump({"note": n["id"], "token": tok["token"], "slug": share["share_slug"]}, open(os.environ.get("UPGRADE_FILE") or os.path.join(tempfile.gettempdir(), "seaglass-upgrade.json"), "w"))
print("seeded")
