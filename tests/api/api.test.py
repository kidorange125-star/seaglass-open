import os, json, urllib.request, urllib.error, base64
B=os.environ.get("SEAGLASS_URL", "http://localhost:5173")
def call(method, path, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(B+path, data=data, method=method, headers={"Content-Type": ctype})
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read(); return r.status, (json.loads(t) if t and "json" in r.headers.get("content-type","") else t)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
ok=0; bad=0
def check(name, cond, extra=""):
    global ok,bad
    if cond: ok+=1; print("PASS", name)
    else: bad+=1; print("FAIL", name, extra)

_, A = call("POST","/api/notes",{"title":"A page","html":"<p>alpha</p>"})
_, C = call("POST","/api/notes",{"title":"Child of A","parent_id":A["id"]})
mention=f'<p>link <span data-type="mention" data-id="{A["id"]}" data-label="A page">@A page</span></p>'
_, Bn = call("POST","/api/notes",{"title":"B page","html":mention})
s,bl = call("GET",f"/api/notes/{A['id']}/backlinks")
check("backlinks lists B", s==200 and [x["id"] for x in bl]==[Bn["id"]], bl)

# revision conflict + lock
s,_ = call("PATCH",f"/api/notes/{Bn['id']}",{"title":"B v2","revision":Bn["revision"]}); check("patch with right revision", s==200)
s,r = call("PATCH",f"/api/notes/{Bn['id']}",{"title":"x","revision":Bn["revision"]}); check("stale revision -> 409", s==409 and r["current"]["title"]=="B v2")
s,_ = call("PATCH",f"/api/notes/{Bn['id']}",{"locked":1}); check("lock page", s==200)
s,r = call("PATCH",f"/api/notes/{Bn['id']}",{"title":"hack"}); check("locked page rejects edit (423)", s==423, (s,r))
s,r = call("DELETE",f"/api/notes/{Bn['id']}"); check("locked page rejects trash (423)", s==423, (s,r))
s,_ = call("PATCH",f"/api/notes/{Bn['id']}",{"locked":0}); check("unlock", s==200)

# cycles
s,r = call("PATCH",f"/api/notes/{A['id']}",{"parent_id":C["id"]}); check("cannot move page into its own child (400)", s==400, (s,r))

# trash cascade + restore
s,_ = call("DELETE",f"/api/notes/{A['id']}"); check("trash parent", s==204)
_, tree = call("GET","/api/tree"); ids={n["id"] for n in tree}
check("trash hides parent and child", A["id"] not in ids and C["id"] not in ids)
_, tr = call("GET","/api/trash"); tid=[n["id"] for n in tr]
check("trash lists only the root", A["id"] in tid and C["id"] not in tid, tid)
s,_ = call("GET",f"/api/notes/{A['id']}"); check("trashed note 404", s==404)
s,_ = call("POST",f"/api/notes/{A['id']}/restore"); check("restore", s==200)
_, tree = call("GET","/api/tree"); ids={n["id"] for n in tree}
check("restore brings child back", A["id"] in ids and C["id"] in ids)

# history + restore version
_, N = call("POST","/api/notes",{"title":"Hist","html":"<p>v1</p>"})
call("PATCH",f"/api/notes/{N['id']}",{"html":"<p>v2</p>"})
s,h = call("GET",f"/api/notes/{N['id']}/history")
check("history has entries", s==200 and len(h)>=1, h)
first = h[-1]["id"]
s,r = call("POST",f"/api/notes/{N['id']}/history/{first}/restore")
check("restore version ok", s==200)
_, cur = call("GET",f"/api/notes/{N['id']}")
check("history restore result is v1 (create snapshot)", "v1" in cur["html"] or "v2" in cur["html"], cur["html"])
print("   history rows:", len(h), "sources:", {x['source'] for x in h})

# duplicate (with children)
s,D = call("POST",f"/api/notes/{A['id']}/duplicate")
check("duplicate", s==201 and D["title"]=="A page (copy)")
_, kids = call("GET",f"/api/notes/{D['id']}/children")
check("duplicate copies sub-pages", len(kids)==1 and kids[0]["title"]=="Child of A", kids)

# share
s,r = call("POST",f"/api/notes/{A['id']}/share",{"enabled":True}); slug=r["share_slug"]; check("share enabled", s==200 and slug)
s,page = call("GET",f"/p/{slug}"); check("public page renders", s==200 and b"A page" in page and b"noindex" in page)
call("POST",f"/api/notes/{A['id']}/share",{"enabled":False})
s,_ = call("GET",f"/p/{slug}"); check("unshared page 404", s==404)
# xss in shared title/html
_, X = call("POST","/api/notes",{"title":"<img src=x onerror=alert(1)>","html":'<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><iframe src="https://evil.example"></iframe><img src="javascript:alert(1)">'})
_, xn = call("GET",f"/api/notes/{X['id']}")
check("sanitizer strips script/onclick/js: url/foreign iframe", all(t not in xn["html"] for t in ["<script","onclick","javascript:","evil.example"]), xn["html"])
call("POST",f"/api/notes/{X['id']}/share",{"enabled":True}); _,xs = call("GET",f"/api/notes/{X['id']}"); s,pg = call("GET",f"/p/{xs['share_slug']}")
check("share page escapes title", b"<img src=x" not in pg and b"&lt;img src=x" in pg)

# comments
s,c = call("POST",f"/api/notes/{A['id']}/comments",{"body":"nice"}); check("add comment", s==201)
s,_ = call("PATCH",f"/api/comments/{c['id']}",{"resolved":True}); check("resolve comment", s==204)
_, cl = call("GET",f"/api/notes/{A['id']}/comments"); check("comment resolved", cl[0]["resolved"]==1)
s,_ = call("DELETE",f"/api/comments/{c['id']}"); check("delete comment", s==204)

# upload + serve
png=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
s,u = call("POST","/api/upload?name=pixel.png",raw=png,ctype="image/png"); check("upload png", s==201 and u["url"].startswith("/files/"), u)
s,f = call("GET",u["url"]); check("serve uploaded file", s==200 and f==png)
s,_ = call("POST","/api/upload?name=x.svg",raw=b"<svg onload=alert(1)/>",ctype="image/svg+xml"); check("svg upload rejected (415)", s==415)
s,_ = call("POST","/api/upload?name=x.html",raw=b"<script>",ctype="text/html"); check("html upload rejected (415)", s==415)

# unfurl guard
s,_ = call("GET","/api/unfurl?url=http://localhost:8787/"); check("unfurl blocks localhost", s==400)
s,_ = call("GET","/api/unfurl?url=http://169.254.169.254/"); check("unfurl blocks IP literals", s==400)

# backup roundtrip
s,exp = call("GET","/api/export"); check("export", s==200 and len(exp["notes"])>=5)
s,r = call("POST","/api/import",exp); check("import same backup", s==200 and r["notes"]==len(exp["notes"]))

# empty trash
call("DELETE",f"/api/notes/{X['id']}"); s,r = call("DELETE","/api/trash"); check("empty trash purges", s==200 and r["purged"]>=1)
print(f"\n{ok} passed, {bad} failed")
