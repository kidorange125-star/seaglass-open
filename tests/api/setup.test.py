# Setup after the account (worker/keys.ts, worker/aisettings.ts): AI on / later / off, keys saved in the app (sealed,
# never sent back), which models may be used, web search, and the notification key Seaglass makes for itself. Real
# accounts with sessions. Run on an EMPTY database (no accounts), ANTHROPIC_API_KEY=mock, no SETUP_CODE. With
# AUTH_OPEN=1 a made-up Claude key is saved without the live check; without it, Claude refuses the made-up key.
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
            with self.o.open(r, timeout=60) as x: return x.status, x.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")
def j(t):
    try: return json.loads(t)
    except Exception: return None

ana, bee = Who(), Who()
check("owner sets up", ana("POST", "/api/setup", {"mode": "household", "household_name": "Setup house", "display_name": "Ana", "username": "ana_setup", "password": "a long test password 1"})[0] in (200, 201))
code = (j(ana("POST", "/api/household/invites", {"role": "adult"})[1]) or {}).get("code")
bee("POST", "/api/join", {"code": code, "display_name": "Bee", "username": "bee_setup", "password": "another long password 2"})
for w in (ana, bee): w("PUT", "/api/agent/permissions", {"add": "allow", "edit": "allow", "delete": "allow"})

s, t = ana("GET", "/api/setup/ai"); d = j(t) or {}
check("setup knows AI is connected (here by the server's own key)", d.get("connected") is True and d.get("settings", {}).get("mode") == "on", d)
keys = {k["name"]: k for k in d.get("keys", [])}
check("...and says where each key comes from", keys.get("ANTHROPIC_API_KEY", {}).get("source") == "secret" and set(keys) == {"ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "OPENROUTER_API_KEY"}, keys)
check("adults see the AI settings but no keys", (j(bee("GET", "/api/setup/ai")[1]) or {}).get("keys") == [])

# ---- keys
check("a key that isn't one is refused", ana("PUT", "/api/setup/keys/ANTHROPIC_API_KEY", {"value": "hello"})[0] == 400)
check("an adult can't save keys", bee("PUT", "/api/setup/keys/ELEVENLABS_API_KEY", {"value": "sk_" + "a" * 40})[0] == 403)
check("unknown key names are refused", ana("PUT", "/api/setup/keys/DATA_KEY", {"value": "x" * 40})[0] == 404)
fake = "sk-ant-api03-" + "Z9y8X7w6" * 6
s, t = ana("PUT", "/api/setup/keys/ANTHROPIC_API_KEY", {"value": fake})
check("a made-up Claude key: saved (test mode) or refused by Claude", s == 200 or (s == 400 and ("accept" in t or "reached" in t)), (s, t))
s, t = ana("PUT", "/api/setup/keys/ELEVENLABS_API_KEY", {"value": "sk_" + "b1c2" * 10})
check("a voice key is saved", s == 200, (s, t))
d = j(ana("GET", "/api/setup/ai")[1]) or {}
el = next((k for k in d.get("keys", []) if k["name"] == "ELEVENLABS_API_KEY"), {})
check("a saved key shows only its last four characters", el.get("saved") and el.get("hint") == "…b1c2" and "b1c2b1c2" not in json.dumps(d), el)
check("a saved key is never in any response", all("b1c2b1c2" not in ana("GET", p)[1] for p in ("/api/setup/ai", "/api/session", "/api/setup", "/api/account")))
check("a saved key can be removed", ana("DELETE", "/api/setup/keys/ELEVENLABS_API_KEY")[0] == 200 and not next((k for k in (j(ana("GET", "/api/setup/ai")[1]) or {}).get("keys", []) if k["name"] == "ELEVENLABS_API_KEY"), {}).get("saved"))
ana("DELETE", "/api/setup/keys/ANTHROPIC_API_KEY")

# ---- notifications get a key without any setup
push = j(ana("GET", "/api/push")[1]) or {}
check("notifications have a signing key Seaglass made itself", isinstance(push.get("key"), str) and len(push["key"]) > 40, push)

# ---- which models
check("an adult can't change AI settings", bee("PUT", "/api/setup/ai", {"mode": "off"})[0] == 403)
check("allowing no models is refused", ana("PUT", "/api/setup/ai", {"models": []})[0] == 400)
check("only Haiku allowed", ana("PUT", "/api/setup/ai", {"models": ["claude-haiku-5-5"]})[0] == 200)
s, t = bee("POST", "/api/agent", {"message": "mock:create Haiku page", "history": [], "model": "claude-opus-5-5"})
used = [m["name"] for m in (j(bee("GET", "/api/usage")[1]) or {}).get("by_model", [])]
check("asking for Opus uses an allowed model instead", used == ["claude-haiku-5-5"], used)
ana("PUT", "/api/setup/ai", {"models": ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]})

# ---- AI later / off
check("AI saved for later", ana("PUT", "/api/setup/ai", {"mode": "later"})[0] == 200)
check("...the app is told", (j(bee("GET", "/api/session")[1]) or {}).get("ai", {}).get("mode") == "later")
check("AI turned off", ana("PUT", "/api/setup/ai", {"mode": "off"})[0] == 200)
s, t = bee("POST", "/api/agent", {"message": "mock:create Not allowed", "history": []})
check("with AI off the assistant refuses", s == 403 and "turned off" in t, (s, t))
for m, p, b in [("POST", "/api/ai/selection", {"action": "fix", "html": "<p>x</p>"}), ("POST", "/api/quick", {"text": "mock:create x"}), ("POST", "/api/search/meaning", {"q": "x"})]:
    check(f"...and so does {p}", bee(m, p, b)[0] == 403)
check("pages still work without AI", bee("POST", "/api/notes", {"title": "No AI page"})[0] in (200, 201))
check("the AI settings themselves stay reachable", ana("GET", "/api/agent/permissions")[0] == 200 and ana("GET", "/api/setup/ai")[0] == 200)
check("AI back on", ana("PUT", "/api/setup/ai", {"mode": "on"})[0] == 200 and bee("POST", "/api/agent", {"message": "mock:create Back on", "history": []})[0] == 200)
print(f"{ok} passed, {bad} failed")
