# Key rotation against the isolated test server (port 5174): seal with K1, switch to K2 (+K1 as previous), re-seal, drop K1.
# It rewrites .dev.vars while it runs (and puts it back at the end), so run it only against the test server and an
# otherwise unused database: SEAGLASS_STATE is the folder the server was started with (default: $TEMP/seaglass-test).
import os, json, subprocess, tempfile, time, urllib.request, urllib.error, shutil
B="http://localhost:5174"; ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"..",".."))
STATE=os.environ.get("SEAGLASS_STATE") or os.path.join(tempfile.gettempdir(),"seaglass-test")
K1="AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw"
import base64
K2=base64.urlsafe_b64encode(bytes((i*11+5)%256 for i in range(32))).decode().rstrip("=")
def call(m,p,b=None):
    r=urllib.request.Request(B+p,data=json.dumps(b).encode() if b is not None else None,method=m,headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(r) as x: t=x.read(); return x.status,(json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t=e.read()
        try: return e.code,json.loads(t)
        except Exception: return e.code,t
def sql(q):
    r=subprocess.run([shutil.which("npx") or "npx","wrangler","d1","execute","seaglass","--local","--persist-to",STATE,"--json","--command",q],capture_output=True,text=True,shell=True,env={**os.environ,"MSYS_NO_PATHCONV":"1"})
    return json.loads(r.stdout)[-1]["results"]
def setvars(*lines):
    open(ROOT+"/.dev.vars","w").write("\n".join(lines)+"\n"); time.sleep(5)
    for _ in range(25):
        try: urllib.request.urlopen(B+"/api/session"); break
        except Exception: time.sleep(1)
ok=bad=0
def check(n,c,x=""):
    global ok,bad
    if c: ok+=1; print("PASS",n)
    else: bad+=1; print("FAIL",n,str(x)[:400])
shutil.copy(ROOT+"/.dev.vars",ROOT+"/.dev.vars.rotkeep")
try:
    sql("DELETE FROM notes; DELETE FROM actions; DELETE FROM links; DELETE FROM changes; DELETE FROM prefs; DELETE FROM comments; DELETE FROM memories; DELETE FROM chats; DELETE FROM embeddings; DELETE FROM push_subs; DELETE FROM push_snooze;")
    setvars("ANTHROPIC_API_KEY=mock","DATA_KEY="+K1,"PUBLIC_URL=")
    s,n=call("POST","/api/notes",{"title":"Rotate me","html":"<p>rotation body</p>"})
    h1=sql(f"SELECT title FROM notes WHERE id='{n['id']}'")[0]["title"]; kid1=h1.split("~")[2]
    setvars("ANTHROPIC_API_KEY=mock","DATA_KEY="+K2,"DATA_KEY_PREVIOUS="+K1,"PUBLIC_URL=")
    s,g=call("GET",f"/api/notes/{n['id']}"); check("with the old key as previous, old data still reads",g["title"]=="Rotate me",g)
    s,st=call("GET","/api/security/status"); check("status shows it needs re-sealing",not st["complete"] and st["key_id"]!=kid1,st)
    for _ in range(6):
        s,st=call("POST","/api/security/seal-all")
        if st["complete"]: break
    check("re-sealing completes",st["complete"],st)
    h2=sql(f"SELECT title, html FROM notes WHERE id='{n['id']}'")[0]
    check("rows are now sealed with the new key id",h2["title"].split("~")[2]==st["key_id"] and h2["html"].split("~")[2]==st["key_id"],h2)
    setvars("ANTHROPIC_API_KEY=mock","DATA_KEY="+K2,"PUBLIC_URL=")
    s,g=call("GET",f"/api/notes/{n['id']}"); check("after dropping the old key everything still reads",g["title"]=="Rotate me" and "rotation body" in g["html"],g)
    setvars("ANTHROPIC_API_KEY=mock","DATA_KEY="+K1,"PUBLIC_URL=")
    s,g=call("GET",f"/api/notes/{n['id']}"); check("the wrong key can't read it (fails, shows nothing)",s==500,(s,str(g)[:100]))
    s,t=call("GET","/api/tree"); check("a request with the wrong key fails as a whole",s==500)
    setvars("ANTHROPIC_API_KEY=mock","PUBLIC_URL=")
    s,t=call("GET","/api/tree"); check("no key at all: the app refuses with a clear message",s==503 and t["error"]=="no_data_key",(s,t))
finally:
    shutil.move(ROOT+"/.dev.vars.rotkeep",ROOT+"/.dev.vars")
print(f"{ok} passed, {bad} failed")
