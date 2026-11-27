# The one ongoing conversation (src/worker/thread.ts): old chats moved in, every turn saved by the server, what the
# model sees (recent window, new-topic breaks, rolling summary), search further back, undo state, unread.
# Mock model, no API_TOKEN, EMPTY database (the old-chat import runs once per database). Run: python tests/api/thread.test.py
import os, json, time, urllib.request, urllib.error
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173")
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:500])
def call(m, p, b=None):
    r = urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r) as x:
            t = x.read(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
def agent(msg, label=None):
    body = {"message": msg}
    if label: body["label"] = label
    r = urllib.request.Request(B + "/api/agent", data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r) as x:
        ev = [json.loads(l) for l in x.read().decode().splitlines() if l.strip()]
    return ev, "".join(e.get("delta", "") for e in ev if e["type"] == "text")
def thread(**q): return call("GET", "/api/thread?" + "&".join(f"{k}={v}" for k, v in q.items()))[1]

# ---- an old separate chat (from before the thread) is moved in, once
s, _ = call("PUT", "/api/chats/chat-old-0001", {"title": "Photosynthesis help", "msgs": [{"role": "user", "text": "what is a chloroplast zebra7"}, {"role": "assistant", "text": "The organelle where photosynthesis happens."}], "updated": 1700000000000})
th = thread(tz="America/New_York", limit=50)
kinds = [(m["role"], m["text"][:30]) for m in th["messages"]]
check("old chats are moved into the thread with a divider", kinds[:3] == [("divider", "Photosynthesis help"), ("user", "what is a chloroplast zebra7"), ("assistant", "The organelle where photosynth")], kinds)
check("...only once", len(thread(limit=50)["messages"]) == 3)

# ---- each turn is saved by the server
ev, text = agent("mock:create Thread page", label="Make a page")
saved = [e for e in ev if e["type"] == "saved"]
check("the stream reports both saved messages", len(saved) == 2 and saved[1].get("reply") is True, saved)
th = thread(limit=50); last2 = th["messages"][-2:]
check("your message and the reply are in the thread", last2[0]["role"] == "user" and last2[0]["text"] == "mock:create Thread page" and last2[0]["meta"]["label"] == "Make a page" and last2[1]["role"] == "assistant", last2)
check("the reply keeps its tools, run id and changes (for Undo)", last2[1]["meta"]["run_id"] and last2[1]["meta"]["changes"] == 1 and last2[1]["meta"]["tools"][0]["name"] == "create_note", last2[1]["meta"])
s, r = call("PATCH", f"/api/thread/{last2[1]['id']}", {"undone": True}); check("undo state is remembered on the message", s == 200 and thread(limit=50)["messages"][-1]["meta"]["undone"] is True)

# ---- what the model sees
ev, text = agent("mock:history")
turns = int(text.split("turns=")[1].split()[0])
check("the model sees the earlier conversation (old chat + this one)", turns >= 3 and "chloroplast" in text, text)
d = call("POST", "/api/thread/divider")[1]
check("a new topic is a divider in the thread", thread(limit=5)["messages"][-1]["role"] == "divider")
ev, text = agent("mock:history"); check("after a new topic the model starts fresh (just this message)", "turns=1 " in text, text)

# ---- search further back
ev, text = agent("mock:pastchats zebra7")
check("search_past_chats finds things before the visible window", "chloroplast zebra7" in text, text[:300])

# ---- a long conversation gets a rolling summary
for i in range(48): agent(f"filler message number {i} about mitochondria")
time.sleep(1.5)
ev, text = agent("mock:history")
check("once older messages slide out of the window they are summarized for the model", "summary=true" in text, text[:200])
turns = int(text.split("turns=")[1].split()[0])
check("...and the window itself stays bounded", turns <= 45, turns)

# ---- paging
th = thread(limit=10); first = th["messages"][0]["seq"]
older = thread(before=first, limit=10)["messages"]
check("older messages page in before the first one", len(older) == 10 and older[-1]["seq"] < first, [m["seq"] for m in older])
newer = thread(after=th["messages"][-3]["seq"])["messages"]
check("and new ones after a seq", len(newer) == 2)
check("bad patches are refused", call("PATCH", f"/api/thread/{last2[1]['id']}", {"undone": "yes"})[0] == 400)

print(f"\n{ok} passed, {bad} failed")
raise SystemExit(1 if bad else 0)
