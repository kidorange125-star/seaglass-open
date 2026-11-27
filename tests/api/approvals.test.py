# The assistant asking before it acts (worker/approvals.ts): Ask pauses the run until Approve or Deny, Never refuses,
# Allow just does it. Run with .dev.vars ANTHROPIC_API_KEY=mock and AUTH_OPEN=1, on an empty database.
import os, json, threading, time, urllib.request
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173")
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, x)
def call(method, path, body=None):
    r = urllib.request.Request(B + path, data=None if body is None else json.dumps(body).encode(), method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"null")

def run(message, answer=None):
    """Starts an agent run; if it asks, answers (True/False) and returns every event."""
    events = []
    def reader():
        r = urllib.request.Request(B + "/api/agent", data=json.dumps({"message": message, "history": []}).encode(), method="POST", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(r) as x:
            for line in x:
                if line.strip(): events.append(json.loads(line))
    t = threading.Thread(target=reader); t.start()
    if answer is not None:
        for _ in range(80):
            asks = [e for e in events if e["type"] == "approval"]
            if asks: break
            time.sleep(0.25)
        if asks: call("POST", f"/api/agent/approvals/{asks[0]['id']}", {"ok": answer})
    t.join(60)
    return events
titles = lambda: [n["title"] for n in call("GET", "/api/tree")[1]]

s, p = call("GET", "/api/agent/permissions")
careful = p["presets"]["careful"]
check("the careful preset asks before changes", careful["add"] == "ask" and careful["delete"] == "ask", careful)
call("PUT", "/api/agent/permissions", careful)

ev = run("mock:create Approved Page", True)
ask = [e for e in ev if e["type"] == "approval"]
check("Ask shows what it wants to do", ask and ask[0]["detail"] == "Create the page “Approved Page”", ask)
check("Approve: it's done", "Approved Page" in titles())
qid = ask[0]["id"] if ask else ""
check("a question can't be answered twice", call("POST", f"/api/agent/approvals/{qid}", {"ok": False})[0] == 410)

ev = run("mock:create Denied Page", False)
res = [e for e in ev if e["type"] == "tool_result"]
check("Deny: nothing is made, and the assistant is told", "Denied Page" not in titles() and res and not res[0]["ok"] and "didn't approve" in res[0]["label"], res)

call("PUT", "/api/agent/permissions", {"add": "never"})
ev = run("mock:create Never Page")
res = [e for e in ev if e["type"] == "tool_result"]
check("Never: refused without asking", "Never Page" not in titles() and not any(e["type"] == "approval" for e in ev) and res and "turned this kind of action off" in res[0]["label"], res)

s, p = call("PUT", "/api/agent/permissions", {"add": "allow", "web": "ask"})
check("web can't be set to Ask (it runs on Claude's side)", p["permissions"]["web"] == "allow", p)
ev = run("mock:create Free Page")
check("Allow: done without asking", "Free Page" in titles() and not any(e["type"] == "approval" for e in ev))

call("PUT", "/api/agent/permissions", {"add": "ask"})
s, q = call("POST", "/api/quick", {"text": "mock:create Quick Page"})
check("a quick action can't stop to ask, so it refuses", "Quick Page" not in titles(), (s, q))

print(f"{ok} passed, {bad} failed")
