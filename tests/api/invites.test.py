# 0.2 households: invites, joining, roles and removing a member (worker/household.ts), with real accounts and sessions.
# Run on an EMPTY database (no accounts) with .dev.vars ANTHROPIC_API_KEY=mock, AUTH_OPEN=1 (sign-ins still work; a
# request with no session falls back to the first account), no SETUP_CODE. SEAGLASS_STATE: the test server's --persist-to
# folder (if any), so the test can count rows after a member is removed.
import os, json, uuid, subprocess, urllib.request, urllib.error, http.cookiejar
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173")
STATE = os.environ.get("SEAGLASS_STATE", "")
MARK = "CANARY" + uuid.uuid4().hex[:10]
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
            with self.o.open(r, timeout=60) as x: t = x.read().decode("utf-8", "replace"); return x.status, t
        except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")
def j(t):
    try: return json.loads(t)
    except Exception: return None
def sql(command):
    args = ["npx", "wrangler", "d1", "execute", "seaglass", "--local", "--json", "--command", command] + (["--persist-to", STATE] if STATE else [])
    out = subprocess.run(args, check=True, capture_output=True, shell=os.name == "nt").stdout
    return json.loads(out)[0]["results"]
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082")

a, b, nobody = Who(), Who(), Who()
s, t = a("POST", "/api/setup", {"mode": "household", "household_name": "Test house", "display_name": "Ana", "username": "ana_owner", "password": "a long test password 1"})
check("owner sets up a household", s in (200, 201), (s, t))
aid = (j(a("GET", "/api/account")[1]) or {}).get("user", {}).get("id")
s, t = a("POST", "/api/notes", {"title": MARK + " Ana's page", "html": f"<p>{MARK}</p>"}); anote = (j(t) or {}).get("id")
s, t = a("POST", "/api/upload", raw=PNG, ctype="image/png"); afile = (j(t) or {}).get("url", "")
check("owner made a page and a file", anote and afile.startswith("/files/"), (s, t))

# ---- inviting
s, t = a("POST", "/api/household/invites", {"label": "Bee", "role": "adult"}); inv = j(t) or {}
code = inv.get("code", "")
check("owner makes an invite: a code and a link", s == 201 and len(code) == 14 and inv.get("link", "").endswith("/#/join/" + code), (s, t))
pend = j(a("GET", "/api/household/invites")[1]) or []
check("the invite is listed (never its code)", len(pend) == 1 and pend[0]["label"] == "Bee" and code not in json.dumps(pend), pend)
s, t = nobody("POST", "/api/join/check", {"code": "AAAA-BBBB-CCCC"})
check("a wrong code is refused", s == 404, (s, t))
s, t = nobody("POST", "/api/join/check", {"code": code.lower().replace("-", " ")})
check("the right code works however it's typed, and says whose household", s == 200 and (j(t) or {}).get("household") == "Test house" and (j(t) or {}).get("invited_by") == "Ana", (s, t))
s, t = b("POST", "/api/join", {"code": code, "display_name": "Bee", "username": "bee_member", "password": "short"})
check("a weak password is refused (and the code isn't used up)", s == 400, (s, t))
s, t = b("POST", "/api/join", {"code": code, "display_name": "Bee", "username": "ana_owner", "password": "another long password 2"})
check("a taken username is refused (and the code isn't used up)", s == 409 and (j(t) or {}).get("field") == "username", (s, t))
s, t = b("POST", "/api/join", {"code": code, "display_name": "Bee", "username": "bee_member", "password": "another long password 2"})
bid = ((j(t) or {}).get("user") or {}).get("id")
check("joining makes an adult account and signs in", s == 201 and ((j(t) or {}).get("user") or {}).get("role") == "adult", (s, t))
check("signed in as Bee", ((j(b("GET", "/api/account")[1]) or {}).get("user") or {}).get("id") == bid)
s, t = nobody("POST", "/api/join", {"code": code, "display_name": "Eve", "username": "eve_x", "password": "yet another long password"})
check("a code works only once", s == 404, (s, t))
check("used invites leave the list", j(a("GET", "/api/household/invites")[1]) == [])

# ---- separation with real sessions
check("Bee sees none of Ana's pages", MARK not in b("GET", "/api/tree")[1])
check("Bee can't open Ana's page by id", b("GET", f"/api/notes/{anote}")[0] == 404)
check("Bee can't open Ana's uploaded file", b("GET", afile)[0] == 404)
check("Ana opens her own file", a("GET", afile)[0] == 200)
s, t = b("POST", "/api/upload", raw=PNG, ctype="image/png"); bfile = (j(t) or {}).get("url", "")
b("POST", "/api/notes", {"title": "Bee's page", "html": f'<p>mine</p><img src="{bfile}">'})
check("Ana can't open Bee's file", a("GET", bfile)[0] == 404)
a("PATCH", f"/api/notes/{anote}", {"html": f'<p>{MARK}</p><img src="{afile}">', "revision": (j(a("GET", f"/api/notes/{anote}")[1]) or {}).get("revision", 1)})
slug = (j(a("POST", f"/api/notes/{anote}/share", {"enabled": True})[1]) or {}).get("share_slug")
check("once it's on a page shared publicly, the file opens for others too", bool(slug) and b("GET", afile)[0] == 200, slug)

# ---- roles
check("an adult can't invite", b("POST", "/api/household/invites", {})[0] == 403)
check("an adult can't change roles", b("PATCH", f"/api/household/members/{aid}", {"role": "adult"})[0] == 403)
check("an adult can't remove someone else", b("DELETE", f"/api/household/members/{aid}", {"confirm": "ana_owner"})[0] == 403)
check("an adult can't run or list backups", b("GET", "/api/backups")[0] == 403 and b("POST", "/api/backups")[0] == 403)
check("the only owner can't step down", a("PATCH", f"/api/household/members/{aid}", {"role": "adult"})[0] == 400)
check("the only owner can't leave", a("DELETE", f"/api/household/members/{aid}", {"confirm": "ana_owner"})[0] == 400)
check("owner makes Bee an owner", a("PATCH", f"/api/household/members/{bid}", {"role": "owner"})[0] == 200)
check("...then back to adult", a("PATCH", f"/api/household/members/{bid}", {"role": "adult"})[0] == 200)
check("going back to just one person needs everyone else gone", a("PUT", "/api/household", {"mode": "individual"})[0] == 400)

# ---- removing
check("removing needs the username typed", a("DELETE", f"/api/household/members/{bid}", {"confirm": "bee"})[0] == 400)
before = sql(f"SELECT COUNT(*) AS n FROM notes WHERE owner_id = '{bid}'")[0]["n"]
s, t = a("DELETE", f"/api/household/members/{bid}", {"confirm": "BEE_member"})
check("owner removes Bee", s == 200, (s, t))
check("Bee's session no longer signs in as Bee", ((j(b("GET", "/api/session")[1]) or {}).get("user") or {}).get("id") != bid)
left = {tbl: sql(f"SELECT COUNT(*) AS n FROM {tbl} WHERE owner_id = '{bid}'")[0]["n"] for tbl in ("notes", "actions", "changes", "prefs", "thread")}
check("everything of Bee's is deleted", before > 0 and not any(left.values()), (before, left))
check("Bee's file is deleted", a("GET", bfile)[0] == 404)
check("Ana's things are untouched", MARK in a("GET", f"/api/notes/{anote}")[1] and a("GET", afile)[0] == 200)
check("only Ana is left", [m["id"] for m in (j(a("GET", "/api/household/members")[1]) or [])] == [aid])

# ---- an invite can be cancelled
inv2 = j(a("POST", "/api/household/invites", {"label": "Cat"})[1]) or {}
pid = (j(a("GET", "/api/household/invites")[1]) or [{}])[0].get("id", "")
check("owner cancels an invite", a("DELETE", f"/api/household/invites/{pid}")[0] == 200)
check("a cancelled invite doesn't work", nobody("POST", "/api/join/check", {"code": inv2.get("code", "")})[0] == 404)
print(f"{ok} passed, {bad} failed")
