import os, json, urllib.request, urllib.error
B=os.environ.get("SEAGLASS_URL", "http://localhost:5173")
def call(m,p,b=None):
    r=urllib.request.Request(B+p,data=json.dumps(b).encode() if b is not None else None,method=m,headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(r) as x: t=x.read(); return x.status,(json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t=e.read()
        try: return e.code,json.loads(t)
        except Exception: return e.code,t
def agent(msg, history=None, page_id=None):
    r=urllib.request.Request(B+"/api/agent",data=json.dumps({"message":msg,"history":history or [],"page_id":page_id}).encode(),method="POST",headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(r) as x:
        ev=[json.loads(l) for l in x.read().decode().splitlines() if l.strip()]
    return ev
ok=bad=0
def check(n,c,x=""):
    global ok,bad
    if c: ok+=1; print("PASS",n)
    else: bad+=1; print("FAIL",n,x)
def titles(): return {n["title"]:n["id"] for n in call("GET","/api/tree")[1]}
def last(ev,t): return [e for e in ev if e["type"]==t]

# --- streaming + create
ev=agent("mock:create Agent Page")
check("stream has text, tool_start, tool_result, done", {e["type"] for e in ev}>={"text","tool_start","tool_result","done"}, [e["type"] for e in ev])
d=last(ev,"done")[0]; check("done reports 1 change + usage", d["changes"]==1 and d["usage"]["output"]>0, d)
check("page was created", "Agent Page" in titles())
pid=titles()["Agent Page"]
runs=call("GET","/api/runs")[1]; check("run listed as applied with summary", runs[0]["state"]=="applied" and "create:Agent Page" in runs[0]["summary"], runs[0])
src=call("GET",f"/api/notes/{pid}")[1]; check("created note is html-sanitized content", "Created by the mock agent" in src["html"])
acts=call("GET",f"/api/notes/{pid}/history")[1]; check("history marks the agent as the source", acts[0]["source"]=="agent", acts)
check("history names which agent: Waffle and its model", acts[0].get("agent")=="Waffle (Sonnet 5.5)", acts[0])
check("the run lists its agents", call("GET","/api/runs")[1][0].get("agents")==["Waffle (Sonnet 5.5)"])

# --- undo / redo a create
r=call("POST","/api/runs/undo")[1]; check("/undo reverts the agent run", r["ok"] and r["changed"]==1, r)
check("undone create goes to the trash", "Agent Page" not in titles() and any(t["id"]==pid for t in call("GET","/api/trash")[1]))
check("run now shows as undone", call("GET","/api/runs")[1][0]["state"]=="undone")
r=call("POST","/api/runs/redo")[1]; check("/redo reapplies it", r["ok"] and "Agent Page" in titles(), r)
check("redo run shows applied again", call("GET","/api/runs")[1][0]["state"]=="applied")
check("nothing left to redo", call("POST","/api/runs/redo")[1]["ok"]==False)

# --- multi-tool run is one undo
ev=agent("mock:multi"); d=last(ev,"done")[0]
check("parallel tool calls in one run", d["changes"]==2 and len(last(ev,"tool_result"))==2, d)
t=titles(); check("both pages exist", "Mock A" in t and "Mock B" in t)
r=call("POST",f"/api/runs/{d['run_id']}/undo")[1]; t=titles()
check("one undo reverts the whole multi-change run", r["ok"] and r["changed"]==2 and "Mock A" not in t and "Mock B" not in t, r)

# --- edit via search + append, undo restores exact content
before=call("GET",f"/api/notes/{pid}")[1]["html"]
ev=agent("mock:edit Agent Page"); d=last(ev,"done")[0]
after=call("GET",f"/api/notes/{pid}")[1]["html"]
check("agent edit: searched then appended", [e["name"] for e in last(ev,"tool_result")]==["search_notes","append_to_note"] and "Added by the mock agent" in after, [e["name"] for e in last(ev,"tool_result")])
check("only the append counts as a change (search is read-only)", d["changes"]==1)
call("POST",f"/api/runs/{d['run_id']}/undo"); check("undo restores the page exactly", call("GET",f"/api/notes/{pid}")[1]["html"]==before)
call("POST",f"/api/runs/{d['run_id']}/redo")

# --- conflict: user edits after the agent, undo must not clobber it
ev=agent("mock:edit Agent Page"); rid=last(ev,"done")[0]["run_id"]
cur=call("GET",f"/api/notes/{pid}")[1]
call("PATCH",f"/api/notes/{pid}",{"html":cur["html"]+"<p>my own later edit</p>","revision":cur["revision"]})
r=call("POST",f"/api/runs/{rid}/undo")[1]
check("undo refuses when the page changed afterwards", r["ok"]==False and r["conflicts"][0]["id"]==pid, r)
check("my later edit is untouched after the refusal", "my own later edit" in call("GET",f"/api/notes/{pid}")[1]["html"])
r=call("POST",f"/api/runs/{rid}/undo",{"force":True})[1]; check("force undo overrides", r["ok"], r)

# --- protections: lock, bad ids, unknown tool, bad input
call("PATCH",f"/api/notes/{pid}",{"locked":1})
ev=agent(f"mock:update {pid} Hacked"); tr=last(ev,"tool_result")[0]
check("locked page rejects the agent", tr["ok"]==False and "locked" in tr["label"].lower() and call("GET",f"/api/notes/{pid}")[1]["title"]=="Agent Page", tr)
check("a failed tool is not counted as a change", last(ev,"done")[0]["changes"]==0)
call("PATCH",f"/api/notes/{pid}",{"locked":0})
tr=last(agent('mock:tool read_note {"id":"not-a-uuid"}'),"tool_result")[0]; check("invalid id gives a readable tool error", tr["ok"]==False and "valid page id" in tr["label"], tr)
tr=last(agent('mock:tool read_note {}'),"tool_result")[0]; check("missing required field is rejected", tr["ok"]==False and "required" in tr["label"], tr)
tr=last(agent('mock:tool launch_missiles {"x":1}'),"tool_result")[0]; check("unknown tool is rejected", tr["ok"]==False and "Unknown tool" in tr["label"], tr)

# --- replace_in_note surgical edit (exact-once rule)
_,n=call("POST","/api/notes",{"title":"Surgery","html":"<p>alpha</p><p>beta</p><p>alpha</p>"})
tr=last(agent(f'mock:tool replace_in_note {{"id":"{n["id"]}","find":"<p>alpha</p>","replace":"<p>X</p>"}}'),"tool_result")[0]
check("replace_in_note refuses an ambiguous match", tr["ok"]==False and "matched 2 times" in tr["label"], tr)
tr=last(agent(f'mock:tool replace_in_note {{"id":"{n["id"]}","find":"<p>beta</p>","replace":"<p>BETA</p>"}}'),"tool_result")[0]
check("replace_in_note edits a unique match", tr["ok"] and "<p>BETA</p>" in call("GET",f"/api/notes/{n['id']}")[1]["html"], tr)

# --- database tools with property names
_,dbn=call("POST","/api/notes",{"kind":"database","title":"Homework","db_schema":{"properties":[{"id":"title","name":"Name","type":"title"},{"id":"st","name":"Status","type":"status","options":[{"id":"a","name":"To do","color":"gray"},{"id":"b","name":"Done","color":"green"}]},{"id":"due","name":"Due","type":"date"},{"id":"pts","name":"Points","type":"number"},{"id":"tg","name":"Tags","type":"multi_select","options":[]}],"views":[{"id":"v","name":"Table","type":"table","filters":[],"filter_mode":"and","sorts":[],"hidden":[]}]}})
tr=last(agent(f'mock:tool add_database_row {{"database_id":"{dbn["id"]}","title":"Essay","properties":{{"Status":"Done","Due":"2026-11-20","Points":10,"Tags":["english","urgent"]}}}}'),"tool_result")[0]
check("add_database_row by property name", tr["ok"], tr)
rows=call("GET",f"/api/notes/{dbn['id']}/children")[1]; p=json.loads(rows[0]["props"])
check("select name mapped to option id, date + number stored", p["st"]=="b" and p["due"]=={"start":"2026-11-20"} and p["pts"]==10, p)
schema=json.loads(call("GET",f"/api/notes/{dbn['id']}")[1]["db_schema"]); check("unknown multi-select options were created", {o["name"] for o in schema["properties"][4]["options"]}=={"english","urgent"})
tr=last(agent(f'mock:tool add_database_row {{"database_id":"{dbn["id"]}","title":"Bad","properties":{{"Nope":1}}}}'),"tool_result")[0]; check("unknown property name is rejected", tr["ok"]==False and "No property" in tr["label"], tr)
tr=last(agent(f'mock:tool update_database_row {{"id":"{rows[0]["id"]}","properties":{{"Status":"To do"}}}}'),"tool_result")[0]
check("update_database_row", tr["ok"] and json.loads(call("GET",f"/api/notes/{rows[0]['id']}")[1]["props"])["st"]=="a", tr)
tr=last(agent(f'mock:tool list_database_rows {{"database_id":"{dbn["id"]}"}}'),"tool_result")[0]; check("list_database_rows", tr["ok"] and "1 rows" in tr["label"], tr)

# --- web search / fetch (server-side tools; the mock model fakes one search and one failed page read)
ev=agent("mock:web how do ducks float")
tr=last(ev,"tool_result")
check("web steps are reported in the chat", [t["name"] for t in tr]==["web_search","web_fetch"] and tr[0]["ok"] and "Searched the web for" in tr[0]["label"] and "how do ducks float" in tr[0]["label"], tr)
check("a failed page read shows as a failed step", tr[1]["ok"]==False and "example.com" in tr[1]["label"], tr[1])
check("web steps are not counted as note changes", last(ev,"done")[0]["changes"]==0 and "[All about ducks](https://example.com/ducks)" in "".join(e["delta"] for e in last(ev,"text")))
ev=agent("mock:web ducks", None, None)
check("web search needs no note ids", all(t["note_ids"]==[] for t in last(ev,"tool_result")))

# --- Write with Jeff (the / menu): one-shot, mock model
s,r=call("POST","/api/ai/write",{"instruction":"two sentences about ducks","title":"Essay","before":"Intro.","after":""}); check("ai/write returns html to insert", s==200 and "two sentences about ducks" in r["html"] and r["html"].startswith("<p>"), (s,r))
s,r=call("POST","/api/ai/write",{"instruction":"","title":"Essay","before":"Some text so the user can continue.","after":""}); check("ai/write can continue without an instruction", s==200 and "(mock)" in r["html"], (s,r))
check("ai/write needs an instruction or some text", call("POST","/api/ai/write",{"instruction":"","before":""})[0]==400)

# --- guards on the endpoint
check("empty message rejected", call("POST","/api/agent",{"message":"  "})[0]==400)
r=agent("mock:trash Surgery"); check("delete_note moves to trash (recoverable) and is undoable", "Surgery" not in titles() and call("POST",f"/api/runs/{last(r,'done')[0]['run_id']}/undo")[1]["ok"] and "Surgery" in titles())
print(f"\n{ok} passed, {bad} failed")
