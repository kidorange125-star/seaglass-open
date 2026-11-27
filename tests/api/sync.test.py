# MCP sync features: timestamps, change feed, content hash, trash, metadata, safe writes, batch reads, paging,
# structure and create_database. Needs the MCP mode of .dev.vars (ANTHROPIC_API_KEY=mock, API_TOKEN=test-token-123,
# PUBLIC_URL= blank) and an empty database. Run: python tests/api/sync.test.py
import os, json, time, urllib.request, urllib.error, re
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173"); TOKEN = "test-token-123"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, str(x)[:600])
def req(method, path, body=None):
    h = dict(AUTH); data = None
    if body is not None: data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x: t = x.read().decode(); return x.status, t
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
def call(name, args=None):
    s, t = req("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})
    r = json.loads(t)["result"]; txt = r["content"][0]["text"]
    try: val = json.loads(txt)
    except Exception: val = txt
    return val, bool(r.get("isError"))
def tool(name, args=None):
    v, err = call(name, args)
    if err: raise AssertionError(f"{name} failed: {v}")
    return v
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
tick = lambda: time.sleep(0.02)

# ---------------------------------------------------------------- tools list
s, t = req("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
names = [x["name"] for x in json.loads(t)["result"]["tools"]]
check("new tools listed", all(n in names for n in ["read_notes", "list_trashed", "set_page_metadata", "create_database"]), names)

# ---------------------------------------------------------------- feed starting point
start = tool("list_recent_changes", {"limit": 1})
check("feed bootstrap gives a cursor + server_time", isinstance(start.get("next_cursor"), str) and ISO.match(start.get("server_time", "")), start)
cur0 = start["next_cursor"]
legacy = tool("list_recent_changes")
check("list_recent_changes without args keeps the old shape (array of runs)", isinstance(legacy, list), legacy)

# ---------------------------------------------------------------- 1. timestamps
folder = tool("create_note", {"title": "Sync folder", "html": "<p>folder</p>"})["id"]
pid = tool("create_note", {"title": "Sync page", "html": "<p>one</p>", "parent_id": folder, "icon": "📘"})["id"]
r = tool("read_note", {"id": pid})
check("read_note: created_at/updated_at ISO UTC", ISO.match(r["created_at"]) and ISO.match(r["updated_at"]), r)
check("read_note: structure + trash fields", r["parent_id"] == folder and r["icon"] == "📘" and r["locked"] is False and isinstance(r["position"], (int, float)) and r["is_trashed"] is False and r["trashed_at"] is None, r)
check("read_note: content_hash is sha-256 hex", re.fullmatch(r"[0-9a-f]{64}", r.get("content_hash", "")) is not None, r)
u0 = r["updated_at"]; tick()
w = tool("update_note", {"id": pid, "title": "Sync page 2"})
u1 = tool("read_note", {"id": pid})["updated_at"]
check("updated_at moves on an MCP title edit (and the write returns it)", u1 > u0 and w.get("updated_at") == u1, (u0, u1, w))
tick(); tool("update_note", {"id": pid, "icon": "📗"}); u2 = tool("read_note", {"id": pid})["updated_at"]
check("updated_at moves on an icon edit", u2 > u1, (u1, u2))
tick(); s, t = req("PATCH", f"/api/notes/{pid}", {"html": "<p>one, edited in the app</p>"})
u3 = tool("read_note", {"id": pid})["updated_at"]
check("updated_at moves on an app edit", s == 200 and u3 > u2, (s, t[:200], u2, u3))
tick()
s, t = req("POST", "/api/agent", {"message": "mock:edit Sync page 2", "history": []})
r = tool("read_note", {"id": pid})
check("updated_at moves on a Jeff edit", s == 200 and r["updated_at"] > u3 and "Added by the mock agent" in r["html"], (s, r["updated_at"], u3))
f = tool("list_recent_changes", {"cursor": cur0, "limit": 500})
last = [x for x in f["changes"] if x["page_id"] == pid][-1]
check("the feed shows Jeff's edit as the page's latest change", last["type"] == "edited" and last["by"] == "jeff", last)
sr = tool("search_notes", {"query": "Sync page"})
check("search_notes items carry timestamps", sr and all(ISO.match(x["updated_at"]) and ISO.match(x["created_at"]) for x in sr), sr)

# ---------------------------------------------------------------- 3. content hash
h1 = tool("read_note", {"id": pid})["content_hash"]
lp = tool("list_pages", {"parent_id": folder})
check("list_pages legacy shape is still an array", isinstance(lp, list), lp)
item = next(x for x in lp if x["id"] == pid)
check("list_pages: hash matches read_note", item["content_hash"] == h1, (item, h1))
check("list_pages: parent_id, position, icon, locked, timestamps", all(k in item for k in ["parent_id", "position", "icon", "locked", "created_at", "updated_at", "is_trashed", "trashed_at"]), item)
tool("update_note", {"id": pid, "favorite": True})
check("hash ignores favorite", tool("read_note", {"id": pid})["content_hash"] == h1)
cur_html = json.loads(req("GET", f"/api/notes/{pid}")[1])["html"]
with_ids = re.sub(r"<p>", '<p data-id="11111111-2222-3333-4444-555555555555">', cur_html, count=1)
req("PATCH", f"/api/notes/{pid}", {"html": with_ids})
check("hash ignores the editor's block ids", tool("read_note", {"id": pid})["content_hash"] == h1)
tool("append_to_note", {"id": pid, "html": "<p>more</p>"})
h2 = tool("read_note", {"id": pid})["content_hash"]
check("hash changes when content changes", h2 != h1)

# ---------------------------------------------------------------- 5. metadata
before = tool("read_note", {"id": pid})
m = tool("set_page_metadata", {"id": pid, "metadata": {"external_ids": {"notion": "abc123"}, "sync": "v1"}})
check("set_page_metadata returns it", m["metadata"] == {"external_ids": {"notion": "abc123"}, "sync": "v1"}, m)
after = tool("read_note", {"id": pid})
check("metadata comes back on read_note", after.get("metadata", {}).get("external_ids") == {"notion": "abc123"}, after)
check("metadata isn't an edit (updated_at and hash unchanged)", after["updated_at"] == before["updated_at"] and after["content_hash"] == before["content_hash"], (before["updated_at"], after["updated_at"]))
m = tool("set_page_metadata", {"id": pid, "metadata": {"sync": None, "x": 1}})
check("merge: null removes, others kept", m["metadata"] == {"external_ids": {"notion": "abc123"}, "x": 1}, m)
check("metadata on list_pages and search", next(x for x in tool("list_pages", {"parent_id": folder}) if x["id"] == pid).get("metadata", {}).get("x") == 1 and any(x.get("metadata") for x in tool("search_notes", {"query": "Sync page"})))
v, err = call("set_page_metadata", {"id": pid, "metadata": {"bad key!": 1}})
check("bad metadata key rejected", err, v)
m = tool("set_page_metadata", {"id": pid, "metadata": {"external_ids": {"notion": "abc123"}}, "replace": True})
check("replace", m["metadata"] == {"external_ids": {"notion": "abc123"}}, m)

# ---------------------------------------------------------------- 6. safe writes
cur = tool("read_note", {"id": pid})
stale = "2000-01-01T00:00:00.000Z"
v, err = call("update_note", {"id": pid, "title": "Should not happen", "if_updated_at": stale})
check("stale if_updated_at rejected with the current version", err and isinstance(v, dict) and v.get("error") == "conflict" and v["current"]["updated_at"] == cur["updated_at"] and "html" in v["current"], v)
check("...and nothing was written", tool("read_note", {"id": pid})["title"] == cur["title"])
w = tool("update_note", {"id": pid, "title": "Sync page 3", "if_updated_at": cur["updated_at"]})
check("fresh if_updated_at accepted", w["ok"] is True)
v, err = call("update_note", {"id": pid, "title": "Lost update", "if_updated_at": cur["updated_at"]})
check("the same if_updated_at again is now stale", err and v.get("error") == "conflict", v)
cur = tool("read_note", {"id": pid})
v, err = call("append_to_note", {"id": pid, "html": "<p>x</p>", "if_hash": "0" * 64})
check("stale if_hash rejected (append_to_note)", err and v.get("error") == "conflict", v)
w = tool("append_to_note", {"id": pid, "html": "<p>appended safely</p>", "if_hash": cur["content_hash"]})
check("matching if_hash accepted (append_to_note)", w["ok"] is True)
cur = tool("read_note", {"id": pid})
v, err = call("replace_in_note", {"id": pid, "find": "appended safely", "replace": "replaced", "if_updated_at": stale})
check("stale if_updated_at rejected (replace_in_note)", err and v.get("error") == "conflict", v)
w = tool("replace_in_note", {"id": pid, "find": "appended safely", "replace": "replaced", "if_updated_at": cur["updated_at"]})
check("fresh if_updated_at accepted (replace_in_note)", w["ok"] is True)
v, err = call("update_note", {"id": pid, "title": "x", "if_updated_at": "yesterday"})
check("malformed if_updated_at is a clear error", err and "ISO 8601" in str(v), v)

# ---------------------------------------------------------------- 8. databases: create, rows, paging, safe row writes
d = tool("create_database", {"title": "Reading list", "parent_id": folder, "icon": "📚", "properties": [
    {"name": "Book", "type": "title"}, {"name": "Status", "type": "status"}, {"name": "Genre", "type": "select", "options": ["Fiction", {"name": "Science", "color": "blue"}]},
    {"name": "Pages", "type": "number"}, {"name": "Finished", "type": "date"}, {"name": "Owned", "type": "checkbox"}]})
dbid = d["id"]
check("create_database", any(p["name"] == "Book" and p["type"] == "title" for p in d["properties"]) and any(p["name"] == "Status" and p.get("options") == ["Not started", "In progress", "Done"] for p in d["properties"]), d)
v, err = call("create_database", {"title": "Bad", "properties": [{"name": "X", "type": "formula"}]})
check("create_database refuses unsupported types", err, v)
rows = [tool("add_database_row", {"database_id": dbid, "title": f"Book {i}", "properties": {"Status": "Not started", "Genre": "Fiction", "Pages": 100 + i}})["id"] for i in range(5)]
page1 = tool("list_database_rows", {"database_id": dbid, "limit": 2})
check("list_database_rows pages with next_cursor + server_time", len(page1["rows"]) == 2 and page1["next_cursor"] and ISO.match(page1["server_time"]), page1)
check("rows carry timestamps, hash, position", all(ISO.match(x["updated_at"]) and len(x["content_hash"]) == 64 and "position" in x for x in page1["rows"]), page1["rows"][0])
seen = [x["id"] for x in page1["rows"]]; c = page1["next_cursor"]
while c:
    p = tool("list_database_rows", {"database_id": dbid, "limit": 2, "cursor": c}); seen += [x["id"] for x in p["rows"]]; c = p["next_cursor"]
check("cursor walks every row once", sorted(seen) == sorted(rows), seen)
mark = tool("list_database_rows", {"database_id": dbid})["server_time"]; tick()
row_now = next(x for x in tool("list_database_rows", {"database_id": dbid})["rows"] if x["id"] == rows[3])
tool("update_database_row", {"id": rows[3], "properties": {"Status": "Done"}, "if_updated_at": row_now["updated_at"]})
ch = tool("list_database_rows", {"database_id": dbid, "updated_since": mark})
check("updated_since returns only the changed row", [x["id"] for x in ch["rows"]] == [rows[3]] and ch["rows"][0]["properties"]["Status"] == "Done", ch)
v, err = call("update_database_row", {"id": rows[3], "properties": {"Status": "Not started"}, "if_updated_at": row_now["updated_at"]})
check("stale if_updated_at rejected (update_database_row) with properties in current", err and v.get("error") == "conflict" and v["current"]["properties"]["Status"] == "Done", v)
rn = tool("read_note", {"id": rows[0]})
check("read_note on a row includes its properties", rn.get("properties", {}).get("Genre") == "Fiction", rn)

# ---------------------------------------------------------------- 7. paging list_pages + read_notes
allp = tool("list_pages", {"all": True, "limit": 2})
got = [x["id"] for x in allp["pages"]]; c = allp["next_cursor"]
while c:
    p = tool("list_pages", {"all": True, "limit": 2, "cursor": c}); got += [x["id"] for x in p["pages"]]; c = p["next_cursor"]
check("list_pages all=true pages through every page and database (no rows)", folder in got and pid in got and dbid in got and not set(rows) & set(got) and len(got) == len(set(got)), got)
mark = allp["server_time"]; tick()
tool("update_note", {"id": folder, "title": "Sync folder 2"})
ch = tool("list_pages", {"all": True, "updated_since": mark})
check("list_pages updated_since", [x["id"] for x in ch["pages"]] == [folder], ch)
missing = "00000000-0000-4000-8000-000000000000"
rn = tool("read_notes", {"ids": [pid, rows[1], missing, dbid]})
check("read_notes returns pages, not_found and omitted_ids", [x["id"] for x in rn["pages"]] == [pid, rows[1], dbid] and rn["not_found"] == [missing] and rn["omitted_ids"] == [], rn)
v, err = call("read_notes", {"ids": [missing] * 51})
check("read_notes caps at 50 ids", err, v)

# ---------------------------------------------------------------- 4. trash + 2. change feed
child = tool("create_note", {"title": "Sync child", "parent_id": pid, "html": "<p>c</p>"})["id"]
other = tool("create_note", {"title": "Elsewhere", "html": "<p>e</p>"})["id"]
tool("update_note", {"id": pid, "parent_id": other})          # moved
tool("delete_note", {"id": pid})                               # trashed (with its child)
r = tool("read_note", {"id": pid})
check("read_note on a trashed page: is_trashed + trashed_at", r["is_trashed"] is True and ISO.match(r["trashed_at"] or ""), r)
tr = tool("list_trashed")
ids = {x["id"]: x for x in tr["pages"]}
check("list_trashed lists the page and its sub-page", pid in ids and child in ids and ids[pid]["trash_root"] is True and ids[child]["trash_root"] is False, tr)
check("trashed pages carry metadata in list_trashed", ids[pid].get("metadata", {}).get("external_ids") == {"notion": "abc123"}, ids.get(pid))
check("trashed pages don't show in search", all(x["id"] != pid for x in tool("search_notes", {"query": "Sync page"})))
v, err = call("update_note", {"id": pid, "title": "x"})
check("edits to a trashed page explain why", err and "trash" in str(v), v)
s, _ = req("POST", f"/api/notes/{pid}/restore")
check("restore in the app", s == 200)
tick(); req("PATCH", f"/api/notes/{pid}", {"title": "Edited in the app"})
s, _ = req("DELETE", f"/api/notes/{child}"); s2, _ = req("DELETE", f"/api/notes/{child}/purge")
check("trash + purge a page in the app", s == 204 and s2 == 204, (s, s2))
v, err = call("read_note", {"id": child})
check("read_note on a purged page: clear not-found", err and "permanently deleted" in str(v), v)

feed, c = [], cur0
for _ in range(50):
    f = tool("list_recent_changes", {"cursor": c, "limit": 3})
    feed += f["changes"]; c = f["next_cursor"]
    if not f["has_more"]: break
check("feed entries: seq, page_id, type, at, by", feed and all(set(["seq", "page_id", "type", "at", "by"]) <= set(x) and ISO.match(x["at"]) for x in feed), feed[:2])
check("feed is ordered by seq, no repeats", [x["seq"] for x in feed] == sorted(set(x["seq"] for x in feed)))
mine = [(x["type"], x["by"]) for x in feed if x["page_id"] == pid]
check("feed for the page: created, edited (quick edits collapse), moved, trashed, restored, edited", [t for t, _ in mine] == ["created", "edited", "moved", "trashed", "restored", "edited"], mine)
check("feed includes app-side changes", mine[-1] == ("edited", "app") and mine[0] == ("created", "mcp"), mine)
check("feed shows the purge as deleted (exists: false)", any(x["page_id"] == child and x["type"] == "deleted" and x.get("exists") is False for x in feed), [x for x in feed if x["page_id"] == child])
check("metadata writes never appear in the feed", not any(x["type"] not in ("created", "edited", "moved", "trashed", "restored", "deleted") for x in feed))
f = tool("list_recent_changes", {"cursor": c})
check("caught up: no changes, cursor stays", f["changes"] == [] and f["next_cursor"] == c and f["has_more"] is False, f)
tool("update_note", {"id": other, "title": "Elsewhere 1"}); tool("update_note", {"id": other, "title": "Elsewhere 2"})
f = tool("list_recent_changes", {"cursor": c})
check("quick consecutive edits show up once", [(x["page_id"], x["type"]) for x in f["changes"]] == [(other, "edited")], f)
since = tool("list_recent_changes", {"since": f["changes"][0]["at"] if f["changes"] else start["server_time"]})
check("since filter", isinstance(since["changes"], list))
v, err = call("list_recent_changes", {"cursor": "abc"})
check("bad cursor is a clear error", err, v)

print(f"\n{ok} passed, {bad} failed")
raise SystemExit(1 if bad else 0)
