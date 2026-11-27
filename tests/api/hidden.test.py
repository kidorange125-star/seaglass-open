# "Hide from AI" end to end: Jeff, MCP and the AI routes can't see or change a hidden page or anything under it;
# The user still can, and only the user can turn it on or off.
# .dev.vars: ANTHROPIC_API_KEY=mock, API_TOKEN=test-token-123, PUBLIC_URL= (blank). Expects an empty database.
import os, json, urllib.request, urllib.error
B = os.environ.get("SEAGLASS_URL", "http://localhost:5173"); TOKEN = "test-token-123"
AUTH = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
ok = bad = 0
def check(n, c, x=""):
    global ok, bad
    if c: ok += 1; print("PASS", n)
    else: bad += 1; print("FAIL", n, x)
def call(m, p, b=None):
    r = urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers=AUTH)
    try:
        with urllib.request.urlopen(r) as x: t = x.read(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
def tool(name, args=None):
    s, r = call("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})
    res = r["result"]; return res.get("isError", False), res["content"][0]["text"]
def agent(msg, page_id=None):
    r = urllib.request.Request(B + "/api/agent", data=json.dumps({"message": msg, "history": [], "page_id": page_id}).encode(), method="POST", headers=AUTH)
    with urllib.request.urlopen(r) as x: return [json.loads(l) for l in x.read().decode().splitlines() if l.strip()]
def jeff_tool(name, args):
    ev = agent(f"mock:tool {name} {json.dumps(args)}")
    return [e for e in ev if e["type"] == "tool_result"][0]

# --- setup: a secret page with a sub-page, an open page that mentions it
_, secret = call("POST", "/api/notes", {"title": "Secret diary", "html": "<p>launch codes are 1234</p>"})
S = secret["id"]
_, child = call("POST", "/api/notes", {"title": "Secret child", "parent_id": S, "html": "<p>more launch codes</p>"})
C = child["id"]
_, openp = call("POST", "/api/notes", {"title": "Open page", "html": f'<p>see <span data-type="mention" data-id="{S}" data-label="Secret diary">Secret diary</span> launch</p>'})
O = openp["id"]

e, t = tool("read_note", {"id": S})
check("before hiding, MCP can read it", not e and "launch codes" in t, t[:200])

s, r = call("POST", f"/api/notes/{S}/ai-hidden", {"hidden": True})
check("The user turns on Hide from AI", s == 200 and r["ai_hidden"] == 1, (s, r))
s, n = call("GET", f"/api/notes/{C}")
check("sub-page reports it's hidden through its parent", s == 200 and n.get("ai_hidden_inherited") is True and n.get("ai_hidden") == 0, n)
s, n = call("GET", f"/api/notes/{S}")
check("The user can still open the hidden page", s == 200 and "launch codes" in n["html"] and n["ai_hidden"] == 1)
s, n = call("PATCH", f"/api/notes/{S}", {"html": "<p>launch codes are 5678</p>"})
check("The user can still edit the hidden page", s == 200 and "5678" in n["html"], (s, n))

# --- MCP reads
for name, args in [("read_note", {"id": S}), ("read_note", {"id": C}), ("read_notes", {"ids": [S, O]}), ("list_pages", {"parent_id": S}), ("list_database_rows", {"database_id": S})]:
    e, t = tool(name, args)
    check(f"MCP {name} naming a hidden page is refused", e and "hidden from AI" in t and "launch" not in t, t[:200])
e, t = tool("search_notes", {"query": "launch"})
check("MCP search doesn't find hidden pages", not e and S not in t and C not in t and "Secret" not in t and O in t, t[:400])
e, t = tool("list_pages", {})
check("MCP list_pages (top level) leaves it out", not e and S not in t and "Secret" not in t and O in t, t[:300])
e, t = tool("list_pages", {"all": True})
check("MCP list_pages all leaves out the page and its sub-page", not e and S not in t and C not in t and "Secret" not in t, t[:300])
e, t = tool("read_note", {"id": O})
check("a mention of the hidden page is blanked out", not e and "Secret diary" not in t and S not in t and "[hidden page]" in t, t[:400])
e, t = tool("list_recent_changes", {"limit": 50})
check("change feed leaves out hidden pages", not e and S not in t and C not in t and "Secret" not in t, t[:300])
e, t = tool("list_trashed", {})
check("list_trashed works", not e)

# --- MCP writes
for name, args in [("update_note", {"id": S, "title": "pwned"}), ("append_to_note", {"id": C, "html": "<p>x</p>"}), ("delete_note", {"id": C}), ("create_note", {"title": "x", "parent_id": S}), ("replace_in_note", {"id": S, "find": "launch", "replace": "x"})]:
    e, t = tool(name, args)
    check(f"MCP {name} on a hidden page is refused", e and "hidden from AI" in t, t[:200])
s, n = call("GET", f"/api/notes/{S}")
check("…and nothing changed", n["title"] == "Secret diary" and "5678" in n["html"] and not n["deleted_at"])
e, t = tool("update_note", {"id": O, "html": f'<p><span data-type="mention" data-id="{S}"></span></p>'})
check("MCP can't write a link to a hidden page either", e and "hidden from AI" in t, t[:200])
e, t = tool("update_note", {"id": O, "title": "Open page 2", "ai_hidden": True, "locked": False})
s, n = call("GET", f"/api/notes/{O}")
check("MCP can't set Hide from AI (the field is ignored)", n.get("ai_hidden") == 0, n.get("ai_hidden"))

# undo of a change on a page hidden afterwards
e, t = tool("create_note", {"title": "Made by Claude"})
X = json.loads(t)["id"]
call("POST", f"/api/notes/{X}/ai-hidden", {"hidden": True})
e, t = tool("undo_last_change", {})
s, n = call("GET", f"/api/notes/{X}")
check("MCP can't undo a change to a page hidden since", e and "hidden from AI" in t and s == 200 and not n["deleted_at"], (t[:200], n.get("deleted_at")))
e, t = tool("list_recent_changes", {})
check("recent runs don't show the hidden page's title", not e and "Made by Claude" not in t, t[:300])

# --- Jeff
tr = jeff_tool("read_note", {"id": S})
check("Jeff read_note on a hidden page is refused", tr["ok"] is False and "hidden from AI" in tr["label"], tr)
tr = jeff_tool("search_notes", {"query": "launch"})
ev = agent('mock:tool search_notes {"query":"launch"}')
check("Jeff search leaves hidden pages out", tr["ok"] and "Secret" not in json.dumps(ev) and S not in json.dumps(ev), tr)
tr = jeff_tool("update_note", {"id": C, "title": "x"})
check("Jeff can't edit a hidden sub-page", tr["ok"] is False and "hidden from AI" in tr["label"], tr)

# --- one-shot AI routes
s, r = call("POST", "/api/ai/selection", {"action": "improve", "html": "<p>launch codes</p>", "page_id": C})
check("Ask Jeff on a selection in a hidden page is refused", s == 403 and "hidden from AI" in r["error"], (s, r))
s, r = call("POST", "/api/ai/write", {"instruction": "continue", "before": "launch", "page_id": S})
check("Write with Jeff on a hidden page is refused", s == 403, (s, r))
s, r = call("POST", "/api/ai/quiz", {"ids": [S], "count": 3})
check("Practice test from only hidden pages is refused", s == 403, (s, r))
s, r = call("POST", "/api/ai/cards", {"id": S})
check("Make flashcards on a hidden page is refused", s == 403, (s, r))

# --- turning it off
s, r = call("POST", f"/api/notes/{S}/ai-hidden", {"hidden": False})
e, t = tool("read_note", {"id": C})
check("after turning it off, AI can see it again (sub-page too)", s == 200 and r["ai_hidden"] == 0 and not e and "launch" in t, t[:200])
s, r = call("POST", "/api/notes/00000000-0000-4000-8000-000000000000/ai-hidden", {"hidden": True})
check("unknown page -> 404", s == 404)

print(f"\n{ok} passed, {bad} failed")
if bad: raise SystemExit(1)
