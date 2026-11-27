# The proactive assistant (src/worker/proactive.ts): saved prompts, routines, the inbox and the hourly check-in.
# Mock model, no API_TOKEN, empty database. Run: python tests/api/proactive.test.py
# Turns proactive mode on (the default is on demand only) and leaves it on.
import os, json, datetime, urllib.request, urllib.error
from zoneinfo import ZoneInfo
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
TZ = ZoneInfo("America/New_York")
def at(y, mo, d, h, mi): return int(datetime.datetime(y, mo, d, h, mi, tzinfo=TZ).timestamp() * 1000)
def cron(ms): urllib.request.urlopen(f"{B}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time={ms}").read()
def inbox(): return call("GET", "/api/inbox?limit=100")[1]
def titled(t): return [i for i in inbox()["items"] if i["title"] == t]
call("GET", "/api/thread?tz=America/New_York")  # the app reports its time zone

# ---- saved prompts
s, p = call("PUT", "/api/prompts", {"name": "/Cram", "text": "Make 15 flashcards from this page and quiz me on the hardest 5."})
check("save a prompt (name cleaned to lowercase, slash dropped)", s == 200 and p["name"] == "cram", (s, p))
check("names must be unique", call("PUT", "/api/prompts", {"name": "cram", "text": "x"})[0] == 400)
check("built-in commands are reserved", call("PUT", "/api/prompts", {"name": "undo", "text": "x"})[0] == 400)
check("bad names are refused", call("PUT", "/api/prompts", {"name": "has space", "text": "x"})[0] == 400)
call("PUT", "/api/prompts", {"id": p["id"], "name": "cram", "text": "Quiz me hard."})
lst = call("GET", "/api/prompts")[1]
check("edit keeps the id and the text reads back", len(lst) == 1 and lst[0]["text"] == "Quiz me hard." and lst[0]["id"] == p["id"], lst)
check("delete a prompt", call("DELETE", f"/api/prompts/{p['id']}")[1]["ok"] and call("GET", "/api/prompts")[1] == [])

# ---- routines
check("a routine needs a valid time", call("PUT", "/api/routines", {"name": "x", "prompt": "y", "time": "25:00"})[0] == 400)
check("...and at least one day", call("PUT", "/api/routines", {"name": "x", "prompt": "y", "time": "07:30", "days": 0})[0] == 400)
WEEKDAYS = 0b0111110  # Monday to Friday
s, r = call("PUT", "/api/routines", {"name": "Morning page", "prompt": "mock:create Routine page", "time": "07:30", "days": WEEKDAYS, "notify": False})
check("save a routine", s == 200 and r["name"] == "Morning page" and r["days"] == WEEKDAYS and r["notify"] is False, (s, r))
# 2030-01-02 is a Wednesday, 2030-01-06 a Sunday
# "On demand only" is the default: nothing runs by itself until proactive mode is on.
check("on demand only by default", call("GET", "/api/assistant-mode")[1]["mode"] == "on_demand")
cron(at(2030, 1, 2, 7, 31)); check("on demand only: the routine doesn't run at its time", not titled("Morning page"))
check("turn on proactive mode", call("PUT", "/api/assistant-mode", {"mode": "proactive"})[1]["mode"] == "proactive")
cron(at(2030, 1, 2, 7, 29)); check("not before its time", not titled("Morning page"))
cron(at(2030, 1, 2, 7, 31)); runs = titled("Morning page")
check("runs at its time, result in the inbox", len(runs) == 1 and runs[0]["source"] == "routine" and "Routine page" in runs[0]["body"], runs)
check("...and it really did the job", any(n["title"] == "Routine page" for n in call("GET", "/api/tree")[1]))
cron(at(2030, 1, 2, 7, 33)); check("only once per day", len(titled("Morning page")) == 1)
cron(at(2030, 1, 6, 7, 30)); check("not on a day it's off (Sunday)", len(titled("Morning page")) == 1)
cron(at(2030, 1, 3, 7, 45)); check("not if the slot is long gone (15 minutes late)", len(titled("Morning page")) == 1)
rid = runs[0]["action"]["run_id"]
check("a routine's changes can be undone", call("POST", f"/api/runs/{rid}/undo", {})[1]["ok"] and not any(n["title"] == "Routine page" for n in call("GET", "/api/tree")[1]))
s, rr = call("POST", f"/api/routines/{r['id']}/run"); check("run now", s == 200 and rr["run_id"], (s, rr))
call("PUT", "/api/routines", {**r, "enabled": False}); cron(at(2030, 1, 7, 7, 30))
check("a paused routine doesn't run", len(titled("Morning page")) == 2)

# ---- hourly check-in (6 AM to 9 PM)
for i in inbox()["items"]: call("POST", f"/api/inbox/{i['id']}", {"action": "done"})
def checkins(): return [i for i in inbox()["items"] if i["source"] == "checkin"]
cron(at(2030, 1, 8, 5, 2)); check("nothing before 6 AM", not checkins())
cron(at(2030, 1, 8, 7, 3)); new = checkins()
check("the check-in leaves its messages in the inbox", len(new) == 2 and {i["kind"] for i in new} == {"note", "proposal"}, new)
note = next(i for i in new if i["kind"] == "note"); prop = next(i for i in new if i["kind"] == "proposal")
check("a note carries a prompt to tap", note["action"]["prompt"] == "(mock) Plan my day." and note["status"] == "new", note)
check("unread count", inbox()["unread"] == 2, inbox()["unread"])
th = call("GET", "/api/thread")[1]
own = [m for m in th["messages"] if m["kind"] == "proactive"]
check("...and they appear in the conversation, linked to their inbox items", len(own) == 2 and {m["meta"]["inbox_id"] for m in own} == {note["id"], prop["id"]}, own)
check("the badge counts what it said on its own", th["unread"] >= 2, th["unread"])
call("POST", "/api/thread/read", {"seq": th["last"]}); check("reading the thread clears the badge", call("GET", "/api/thread/unread")[1]["unread"] == 0)
rt = [m for m in th["messages"] if m["kind"] == "routine"]
check("routine reports are in the conversation too", len(rt) >= 2 and rt[0]["meta"]["title"] == "Morning page", rt[:1])
cron(at(2030, 1, 8, 7, 6)); check("once per hour", len(checkins()) == 2)
cron(at(2030, 1, 8, 8, 2))
check("it doesn't repeat itself (it sees what it already said today)", len(checkins()) == 2)
cron(at(2030, 1, 9, 21, 4)); check("9 PM still checks in (a new day, so new messages)", len(checkins()) == 4)
cnt = len(inbox()["items"]); cron(at(2030, 1, 9, 22, 1)); check("nothing after 9 PM", len(inbox()["items"]) == cnt)

# ---- acting on the inbox
s, a = call("POST", f"/api/inbox/{prop['id']}", {"action": "accept", "today": "2030-01-08"})
check("accepting a proposal applies it", s == 200 and a["ok"] and a["note_ids"], (s, a))
tdb = call("POST", "/api/tasks/ensure", {})[1]["id"]
task = next((n for n in call("GET", f"/api/notes/{tdb}/children")[1] if n["title"] == "(mock) Read chapter 5"), None)
check("...a real task with its due date", task and json.loads(task["props"])["due"] == {"start": "2030-01-03"}, task)
check("accepting twice does nothing more", call("POST", f"/api/inbox/{prop['id']}", {"action": "accept"})[1].get("already") is True)
check("...and it can be undone", call("POST", f"/api/runs/{a['run_id']}/undo", {})[1]["ok"])
check("a note can't be accepted", call("POST", f"/api/inbox/{note['id']}", {"action": "accept"})[0] == 400)
call("POST", f"/api/inbox/{note['id']}", {"action": "dismiss"})
check("dismiss", next(i for i in inbox()["items"] if i["id"] == note["id"])["status"] == "dismissed")
call("POST", f"/api/inbox/{note['id']}/feedback", {"value": -1})
check("feedback", next(i for i in inbox()["items"] if i["id"] == note["id"])["feedback"] == -1)
check("unknown item is a 404", call("POST", "/api/inbox/00000000-0000-4000-8000-000000000000", {"action": "dismiss"})[0] == 404)
s, r = call("POST", "/api/checkin/run"); check("check in now (manual)", s == 200 and "messages" in r, (s, r))

print(f"\n{ok} passed, {bad} failed")
raise SystemExit(1 if bad else 0)
