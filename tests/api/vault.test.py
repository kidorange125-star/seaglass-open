# Encryption at rest, end to end: what is really stored, the move of old plaintext data onto the key, files, and the status.
# Needs the isolated test server (.dev.vars: ANTHROPIC_API_KEY=mock, DATA_KEY=<32 bytes>, no API_TOKEN) and an empty database.
# It reads the raw database with wrangler, so set SEAGLASS_STATE to the same folder the server uses.
#   Run: SEAGLASS_STATE="$TEMP/seaglass-test" python tests/api/vault.test.py
import os, json, subprocess, tempfile, urllib.request, urllib.error, shutil
B = os.environ.get("SEAGLASS_URL", "http://localhost:5174")
STATE = os.environ.get("SEAGLASS_STATE") or os.path.join(tempfile.gettempdir(), "seaglass-test")
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:600])
def call(m, p, b=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(b).encode() if b is not None else None)
    r = urllib.request.Request(B + p, data=data, method=m, headers={"Content-Type": ctype} if data is not None else {})
    try:
        with urllib.request.urlopen(r) as x:
            t = x.read()
            try: return x.status, json.loads(t) if t else None
            except Exception: return x.status, t
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
NPX = shutil.which("npx") or "npx"
def sql(q, file=False):
    args = [NPX, "wrangler", "d1", "execute", "seaglass", "--local", "--persist-to", STATE, "--json"]
    if file:
        f = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8"); f.write(q); f.close()
        args += ["--file", f.name]
    else: args += ["--command", q]
    r = subprocess.run(args, capture_output=True, text=True, shell=(os.name == "nt"), env={**os.environ, "MSYS_NO_PATHCONV": "1"})
    try: return json.loads(r.stdout)[-1]["results"]
    except Exception: raise SystemExit(f"wrangler failed: {r.stdout[:300]} {r.stderr[:300]}")

SECRET = "zebra-quokka-7731"
# ---- new data is stored as ciphertext
s, n = call("POST", "/api/notes", {"title": f"Diary {SECRET}", "html": f"<p>my secret is {SECRET}</p>", "icon": "🔒"}); nid = n["id"]
raw = sql(f"SELECT title, html, text, props, icon, meta FROM notes WHERE id = '{nid}'")[0]
check("title, html, text, props, icon and meta are all sealed", all(str(v).startswith("~sg1~") for v in raw.values()), raw)
check("the secret never appears in the stored row", SECRET not in json.dumps(raw))
s, got = call("GET", f"/api/notes/{nid}"); check("the API still returns the plaintext", got["title"] == f"Diary {SECRET}" and SECRET in got["html"] and got["icon"] == "🔒", got)
call("PATCH", f"/api/notes/{nid}", {"html": f"<p>second version {SECRET}</p>", "revision": got["revision"]})
a = sql(f"SELECT before_json, after_json FROM actions WHERE note_id = '{nid}'")
check("history snapshots are sealed too", all(str(r[k]).startswith("~sg1~") for r in a for k in ("before_json", "after_json") if r[k]) and SECRET not in json.dumps(a), a)
s, r = call("GET", f"/api/search?q={SECRET}"); check("keyword search still finds the page", any(h["id"] == nid for h in (r if isinstance(r, list) else r.get("results", []))), r)
s, c = call("POST", f"/api/notes/{nid}/comments", {"body": f"comment {SECRET}"}); craw = sql("SELECT body FROM comments")[0]["body"]
check("comments are sealed and read back", craw.startswith("~sg1~") and call("GET", f"/api/notes/{nid}/comments")[1][0]["body"] == f"comment {SECRET}", craw)
s, m = call("POST", "/api/agent", {"message": f"mock:remember loves {SECRET}", "history": []})
mem = sql("SELECT text FROM memories")
check("Jeff's memories are sealed", mem and all(r["text"].startswith("~sg1~") for r in mem) and SECRET not in json.dumps(mem), mem)
s, cs = call("PUT", "/api/chats/chat-0001", {"title": f"Chat {SECRET}", "msgs": [{"role": "user", "text": f"hello {SECRET}"}], "updated": 1700000000000})
craw = sql("SELECT title, messages, text FROM chats")
back = call("GET", "/api/chats")[1]
check("synced chats are sealed and read back", s == 200 and back[0]["title"] == f"Chat {SECRET}" and craw and all(str(v).startswith("~sg1~") for v in craw[0].values()) and SECRET not in json.dumps(craw), (s, craw))

# ---- files are sealed in storage and served intact
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082")
s, up = call("POST", "/api/upload?name=dot.png", raw=PNG, ctype="image/png"); check("upload works", s == 201, up)
req = urllib.request.urlopen(B + up["url"]); body = req.read()
check("the file comes back byte for byte, with its type", body == PNG and req.headers["Content-Type"] == "image/png", (len(body), req.headers["Content-Type"]))
s, bad_ = call("GET", "/files/00000000-0000-0000-0000-000000000000/none.png"); check("a missing file is a 404", s == 404)

# ---- data from before encryption: still readable, then moved onto the key
legacy = f"""
INSERT INTO notes (id,parent_id,kind,title,html,text,icon,cover,favorite,position,full_width,small_text,font,locked,is_template,props,db_schema,revision,created_at,updated_at)
 VALUES ('11111111-1111-4111-8111-111111111111',NULL,'database','My tasks','','',NULL,NULL,0,50,0,0,'sans',0,0,'{{}}','{{"system":"tasks","properties":[{{"id":"title","name":"Task","type":"title"}},{{"id":"status","name":"Status","type":"status","options":[{{"id":"todo","name":"Not started","color":"gray"}}]}},{{"id":"due","name":"Due","type":"date"}}],"views":[]}}',1,1700000000000,1700000000000);
INSERT INTO notes (id,parent_id,kind,title,html,text,icon,cover,favorite,position,full_width,small_text,font,locked,is_template,props,db_schema,revision,created_at,updated_at)
 VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','page','Legacy {SECRET} task','','',NULL,NULL,0,1,0,0,'sans',0,0,'{{"status":"todo","due":{{"start":"2030-01-02"}}}}',NULL,1,1700000000000,1700000000000);
INSERT INTO notes (id,parent_id,kind,title,html,text,icon,cover,favorite,position,full_width,small_text,font,locked,is_template,props,db_schema,revision,created_at,updated_at)
 VALUES ('33333333-3333-4333-8333-333333333333',NULL,'page','Old page {SECRET}','<p>old {SECRET} body</p>','old {SECRET} body','📜',NULL,0,2,0,0,'sans',0,0,'{{}}',NULL,1,1700000000000,1700000000000);
INSERT INTO actions (run_id,source,tool,note_id,before_json,after_json,created_at) VALUES ('legacy-run','user','update','33333333-3333-4333-8333-333333333333','{{"title":"Old {SECRET}"}}','{{"title":"Old page {SECRET}"}}',1700000000000);
INSERT INTO memories (id,text,source,created_at,updated_at) VALUES ('legacy1','Legacy memory {SECRET}','agent',1700000000000,1700000000000);
INSERT INTO comments (id,note_id,body,resolved,created_at) VALUES ('legacyc','33333333-3333-4333-8333-333333333333','legacy comment {SECRET}',0,1700000000000);
"""
sql(legacy, file=True)
s, st = call("GET", "/api/security/status")
check("status counts what is still plaintext", st["enabled"] and not st["complete"] and sum(t["remaining"] for t in st["tables"]) >= 5, st)
s, g = call("GET", "/api/notes/33333333-3333-4333-8333-333333333333"); check("old plaintext rows are still readable meanwhile", g["title"] == f"Old page {SECRET}" and SECRET in g["html"], g)
setup = call("GET", "/api/setup")[1]["checks"]; v = next(c for c in setup if c["id"] == "vault"); check("the setup screen says it is still working", not v["ok"] and "left" in v["detail"], v)
s, st = call("POST", "/api/security/seal-all")
for _ in range(5):
    if st["complete"]: break
    s, st = call("POST", "/api/security/seal-all")
check("sealing finishes", st["complete"] and all(t["remaining"] == 0 for t in st["tables"]), st)
rows = sql("SELECT id, title, html, text, props, db_schema, system, dated, revision, updated_at FROM notes WHERE id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333')")
by = {r["id"][0]: r for r in rows}
check("the old rows are now ciphertext", all(str(r[k]).startswith("~sg1~") for r in rows for k in ("title", "props") if r[k]) and SECRET not in json.dumps(rows), rows)
check("the two plain flags were recomputed", by["1"]["system"] == "tasks" and by["2"]["dated"] == 1 and by["3"]["dated"] == 0, rows)
check("sealing didn't touch revisions or edit times", all(r["revision"] == 1 and r["updated_at"] == 1700000000000 for r in rows), rows)
s, g = call("GET", "/api/notes/33333333-3333-4333-8333-333333333333"); check("the content is unchanged after sealing", g["title"] == f"Old page {SECRET}" and SECRET in g["html"] and g["icon"] == "📜", g)
hist = sql("SELECT before_json, after_json FROM actions WHERE run_id = 'legacy-run'")[0]
check("old history snapshots were sealed", hist["before_json"].startswith("~sg1~") and hist["after_json"].startswith("~sg1~"))
check("old memories and comments were sealed", sql("SELECT text FROM memories WHERE id = 'legacy1'")[0]["text"].startswith("~sg1~") and sql("SELECT body FROM comments WHERE id = 'legacyc'")[0]["body"].startswith("~sg1~"))
s, home = call("GET", "/api/home"); check("dated rows from old data show up on Home", any(u["title"] == f"Legacy {SECRET} task" for u in home["upcoming"]), home)
s, td = call("POST", "/api/tasks/ensure", {}); check("the built-in task list is found by its flag, not duplicated", td["id"] == "11111111-1111-4111-8111-111111111111" and not td["created"], td)
check("everything is on the current key afterwards", call("GET", "/api/security/status")[1]["complete"])
s, ex = call("GET", "/api/export"); check("the export is readable plaintext (your own backup)", SECRET in json.dumps(ex), str(ex)[:200])

# ---- the data can't be moved around inside the database
a_id, b_id = nid, "33333333-3333-4333-8333-333333333333"
ta = sql(f"SELECT title FROM notes WHERE id = '{a_id}'")[0]["title"]
sql(f"UPDATE notes SET title = '{ta}' WHERE id = '{b_id}'")
s, r = call("GET", f"/api/notes/{b_id}"); check("a sealed value copied onto another page is refused (never shown as that page's title)", s == 500, (s, str(r)[:200]))

print(f"\n{ok} passed, {bad} failed")
raise SystemExit(1 if bad else 0)
