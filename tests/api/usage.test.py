# AI usage and limits (worker/usage.ts) and kid accounts (role "kid": teach mode, no web, a daily allowance), with real
# accounts and sessions. Run on an EMPTY database (no accounts) with .dev.vars ANTHROPIC_API_KEY=mock, AUTH_OPEN=1 and
# DEFAULT_AGENT_PERMISSIONS=free, no SETUP_CODE.
import os, json, urllib.request, urllib.error, http.cookiejar
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173")
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:300])
class Who:
    def __init__(self): self.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def __call__(self, method, path, body=None):
        r = urllib.request.Request(B + path, data=None if body is None else json.dumps(body).encode(), method=method, headers={"Content-Type": "application/json"})
        try:
            with self.o.open(r, timeout=90) as x: return x.status, x.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")
    def agent(self, message):
        s, t = self("POST", "/api/agent", {"message": message, "history": []})
        return [json.loads(l) for l in t.splitlines() if l.strip().startswith("{")] if s == 200 else [{"type": "http", "status": s, "body": t}]
def j(t):
    try: return json.loads(t)
    except Exception: return None

ana, kid, adult = Who(), Who(), Who()
check("owner sets up", ana("POST", "/api/setup", {"mode": "household", "household_name": "Usage house", "display_name": "Ana", "username": "ana_usage", "password": "a long test password 1"})[0] in (200, 201))
def join(who, role, name):
    code = (j(ana("POST", "/api/household/invites", {"role": role, "label": name})[1]) or {}).get("code")
    s, t = who("POST", "/api/join", {"code": code, "display_name": name, "username": f"{name.lower()}_usage", "password": "another long password 2"})
    return ((j(t) or {}).get("user") or {})
k = join(kid, "kid", "Kit"); kid_id = k.get("id")
check("a kid joins with the kid role", k.get("role") == "kid", k)
a = join(adult, "adult", "Ada")
# The assistant must act without asking here, whatever DEFAULT_AGENT_PERMISSIONS says.
for w in (ana, kid, adult): w("PUT", "/api/agent/permissions", {"add": "allow", "edit": "allow", "delete": "allow"})

# ---- a kid's starting rules, which they can't change
mine = j(kid("GET", "/api/usage")[1]) or {}
check("a kid starts with teach mode, no web and a small daily allowance", mine.get("rules") == {"daily_usd": 0.25, "monthly_usd": 3, "web": False, "teach": True}, mine.get("rules"))
check("an adult has no limits", (j(adult("GET", "/api/usage")[1]) or {}).get("rules") == {"daily_usd": None, "monthly_usd": None, "web": True, "teach": False})
check("a kid can't change their own rules", kid("PUT", f"/api/household/rules/{kid_id}", {"daily_usd": 100, "web": True})[0] == 403)
check("a kid can't see everyone's usage", kid("GET", "/api/household/usage")[0] == 403)
check("a kid can't delete their own account", kid("DELETE", f"/api/household/members/{kid_id}", {"confirm": "kit_usage"})[0] == 403)

# ---- teach mode
s, t = kid("POST", "/api/ai/write", {"instruction": "write my essay", "title": "Essay", "before": "", "after": ""})
check("teach mode: no 'write with the assistant'", s == 403 and "learn" in t, (s, t))
s, t = kid("POST", "/api/ai/selection", {"action": "improve", "html": "<p>my essay</p>"})
check("teach mode: no rewriting their work", s == 403, (s, t))
s, t = kid("POST", "/api/ai/selection", {"action": "fix", "html": "<p>my esay</p>"})
check("teach mode: fixing spelling still works", s == 200, (s, t))
s, t = adult("POST", "/api/ai/selection", {"action": "improve", "html": "<p>my essay</p>"})
check("adults can still have writing improved", s == 200, (s, t))

# ---- usage is recorded
ev = kid.agent("mock:create Kit's page")
check("the kid's assistant works", any(e["type"] == "done" for e in ev), ev[-1:])
mine = j(kid("GET", "/api/usage")[1]) or {}
check("the request is recorded: cost, feature and model", mine.get("today", 0) > 0 and any(f["name"] == "assistant" for f in mine.get("by_feature", [])) and mine.get("by_model"), mine)
check("one-shot features are recorded too", any(f["name"] == "explain" or f["name"] == "rewrite" or f["calls"] for f in mine.get("by_feature", [])) and sum(f["calls"] for f in mine.get("by_feature", [])) >= 2, mine.get("by_feature"))
adult_mine = j(adult("GET", "/api/usage")[1]) or {}
check("nobody else's usage is in mine", not any(f["name"] == "assistant" for f in adult_mine.get("by_feature", [])) and sum(f["calls"] for f in adult_mine.get("by_feature", [])) == 1, adult_mine.get("by_feature"))
home = j(ana("GET", "/api/household/usage")[1]) or {}
kp = next((p for p in home.get("people", []) if p["id"] == kid_id), {})
check("the owner sees each person's totals", kp.get("calls", 0) >= 2 and kp.get("month", 0) > 0, kp)
check("...and never what they asked", "Kit's page" not in json.dumps(home) and "esay" not in json.dumps(home))

# ---- limits stop the next request
check("the owner sets the kid's daily limit to nothing", ana("PUT", f"/api/household/rules/{kid_id}", {"daily_usd": 0})[0] == 200)
ev = kid.agent("mock:create Another page")
err = " ".join(str(e.get("message", e.get("body", ""))) for e in ev if e["type"] in ("error", "http"))
check("over the daily limit, the assistant refuses", "allowance" in err and not any(e["type"] == "done" for e in ev), ev)
s, t = kid("POST", "/api/ai/selection", {"action": "fix", "html": "<p>x</p>"})
check("...and so do the one-shot features", s == 400 and "allowance" in t, (s, t))
check("the adult isn't affected", any(e["type"] == "done" for e in adult.agent("mock:create Ada's page")))
check("a household monthly limit", ana("PUT", "/api/household/rules/household", {"monthly_usd": 0})[0] == 200)
ev = adult.agent("mock:create Blocked page")
check("...stops everyone once it's reached", any("household" in str(e.get("message", e.get("body", ""))) for e in ev), ev)
ana("PUT", "/api/household/rules/household", {"monthly_usd": None})
ana("PUT", f"/api/household/rules/{kid_id}", {"daily_usd": 0.25})
check("limits lifted, the kid can use it again", any(e["type"] == "done" for e in kid.agent("mock:create Back again")))
s, t = ana("PUT", f"/api/household/rules/{kid_id}", {"daily_usd": -5})
check("a limit must be a positive number", s == 400, (s, t))

# ---- web and teach are the owner's to change
check("the owner turns web on for the kid", (j(ana("PUT", f"/api/household/rules/{kid_id}", {"web": True})[1]) or {}).get("web") is True)
check("...and the kid sees it", (j(kid("GET", "/api/usage")[1]) or {}).get("rules", {}).get("web") is True)

# ---- a forgotten password
check("the owner sets a new password for the kid", ana("POST", f"/api/household/members/{kid_id}/password", {"password": "a brand new password 3"})[0] == 200)
check("the kid's old session is signed out", ((j(kid("GET", "/api/session")[1]) or {}).get("user") or {}).get("id") != kid_id)
check("the new password works", kid("POST", "/api/login", {"username": "kit_usage", "password": "a brand new password 3"})[0] == 200)
ana_id = ((j(ana("GET", "/api/account")[1]) or {}).get("user") or {}).get("id")
check("an owner's password can't be reset this way", ana("POST", f"/api/household/members/{ana_id}/password", {"password": "a brand new password 3"})[0] == 403)
check("an adult can't reset passwords", adult("POST", f"/api/household/members/{kid_id}/password", {"password": "a brand new password 4"})[0] == 403)
print(f"{ok} passed, {bad} failed")
