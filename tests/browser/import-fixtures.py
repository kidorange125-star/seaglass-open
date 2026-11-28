# Builds the exports tests/browser/import.cjs imports: made here, in the shapes each app writes, since real exports
# can't be checked in. Zips are made by Python's zipfile so the app's own zip reader meets deflated and stored entries,
# a zip inside a zip, and Zip64. Usage: python tests/browser/import-fixtures.py <folder>
import base64, io, json, os, sys, zipfile

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082")
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"

def zipit(name, files, *, zip64=False, stored=()):
    with zipfile.ZipFile(os.path.join(out, name), "w", zipfile.ZIP_DEFLATED) as z:
        for path, data in files.items():
            info = zipfile.ZipInfo(path)
            info.compress_type = zipfile.ZIP_STORED if path in stored else zipfile.ZIP_DEFLATED
            with z.open(info, "w", force_zip64=zip64) as f:
                f.write(data if isinstance(data, bytes) else data.encode("utf-8"))

# ---- Obsidian: a vault with links, embeds, front matter, a folder note, a checklist, an unused attachment
zipit("vault.zip", {
    "My Vault/.obsidian/app.json": "{}",
    "My Vault/Home.md": """---
tags: [school, ideas]
created: 2024-03-05
---
# Home

See [[Projects/Plan|the plan]] and [[Missing page]].

![[pic.png]]

==Remember this== and `[[not a link]]`.

- [ ] buy paper
- [x] call mum

```
[[inside code]]
```
""",
    "My Vault/Projects/Projects.md": "The projects folder's own note.",
    "My Vault/Projects/Plan.md": "Back to [[Home]]. Read ![[notes.pdf]]\n",
    "My Vault/attachments/pic.png": PNG,
    "My Vault/attachments/notes.pdf": PDF,
    "My Vault/attachments/unused.png": PNG,
}, stored=("My Vault/attachments/pic.png",))

# ---- Notion: Markdown & CSV, a zip of zips, the inner one Zip64; ids on every name; a database with a row page whose
# file name Notion shortened.
I = lambda n: (str(n) * 32)[:32]
inner = io.BytesIO()
with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as z:
    def put(p, d):
        with z.open(zipfile.ZipInfo(p), "w", force_zip64=True) as f: f.write(d if isinstance(d, bytes) else d.encode("utf-8"))
    put(f"Trip {I(1)}.md", f"# Trip\n\nOur plan. See [Day 1](Trip%20{I(1)}/Day%201%20{I(2)}.md).\n\n![photo](Trip%20{I(1)}/photo.png)\n\n[Tasks](Trip%20{I(1)}/Tasks%20{I(3)}.csv)\n")
    put(f"Trip {I(1)}/Day 1 {I(2)}.md", "# Day 1\n\nMuseum, then lunch.\n")
    put(f"Trip {I(1)}/photo.png", PNG)
    put(f"Trip {I(1)}/Tasks {I(3)}.csv", "﻿Name,Status,Due,Done\nBuy tickets,Done,\"November 10, 2026\",Yes\nPack bags and snacks for the whole trip,Not started,\"November 12, 2026\",No\n")
    put(f"Trip {I(1)}/Tasks {I(3)}_all.csv", "﻿Name,Status,Due,Done\nBuy tickets,Done,\"November 10, 2026\",Yes\nPack bags and snacks for the whole trip,Not started,\"November 12, 2026\",No\nBook hotel,In progress,,No\n")
    put(f"Trip {I(1)}/Tasks {I(3)}/Buy tickets {I(4)}.md", "# Buy tickets\n\nStatus: Done\n\nTrain at 9.\n")
    put(f"Trip {I(1)}/Tasks {I(3)}/Pack bags and snacks f {I(5)}.md", "# Pack bags and snacks for the whole trip\n\nDon't forget the charger.\n")
outer = io.BytesIO()
with zipfile.ZipFile(outer, "w", zipfile.ZIP_STORED) as z:
    z.writestr("Export-abc123-Part-1.zip", inner.getvalue())
open(os.path.join(out, "notion.zip"), "wb").write(outer.getvalue())

# ---- Google Keep (Takeout)
usec = lambda s: s * 1_000_000
keep = {
    "Takeout/Keep/Shopping.json": json.dumps({"title": "Shopping", "listContent": [{"text": "Milk", "isChecked": False}, {"text": "Eggs", "isChecked": True}],
        "labels": [{"name": "Home"}], "isTrashed": False, "isArchived": False, "createdTimestampUsec": usec(1_600_000_000), "userEditedTimestampUsec": usec(1_600_000_500)}),
    "Takeout/Keep/Shopping.html": "<html><body>duplicate</body></html>",
    "Takeout/Keep/Idea.json": json.dumps({"title": "", "textContent": "Paint the shed green\nSee https://example.com/paint", "attachments": [{"filePath": "shed.jpg", "mimetype": "image/jpeg"}],
        "isTrashed": False, "isArchived": False, "annotations": [{"url": "https://example.com/paint", "title": "Paint shop"}], "createdTimestampUsec": usec(1_500_000_000), "userEditedTimestampUsec": usec(1_500_000_000)}),
    "Takeout/Keep/shed.jpeg": PNG,
    "Takeout/Keep/Old.json": json.dumps({"title": "Old idea", "textContent": "archived words", "isTrashed": False, "isArchived": True, "createdTimestampUsec": usec(1_400_000_000), "userEditedTimestampUsec": usec(1_400_000_000)}),
    "Takeout/Keep/Gone.json": json.dumps({"title": "Binned", "textContent": "trashed words", "isTrashed": True, "isArchived": False}),
    "Takeout/Keep/Labels.txt": "Home\n",
}
zipit("takeout.zip", keep)

# ---- Evernote: two notebooks; self-closing en-todo with words after, en-media straight under en-note with blocks after it
import hashlib
h = hashlib.md5(PNG).hexdigest(); hp = hashlib.md5(PDF).hexdigest()
def enex(notes):
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export application="Evernote">' + "".join(notes) + "</en-export>"
def note(title, body, *, tags=(), res=(), created="20230102T030405Z"):
    content = f'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>{body}</en-note>'
    r = "".join(f'<resource><data encoding="base64">{base64.b64encode(d).decode()}</data><mime>{m}</mime><resource-attributes><file-name>{n}</file-name></resource-attributes></resource>' for d, m, n in res)
    return f"<note><title>{title}</title><content><![CDATA[{content}]]></content><created>{created}</created><updated>{created}</updated>{''.join(f'<tag>{t}</tag>' for t in tags)}{r}</note>"
open(os.path.join(out, "Recipes.enex"), "w", encoding="utf-8").write(enex([
    note("Pancakes", f'<div><en-todo checked="true"/>flour&nbsp;first</div><div><en-todo/>eggs second</div><en-media hash="{h}" type="image/png"/><div>Mix well after.</div><div><en-media hash="{hp}" type="application/pdf"/></div>',
         tags=("breakfast", "easy"), res=((PNG, "image/png", "pan.png"), (PDF, "application/pdf", "recipe.pdf"))),
]))
open(os.path.join(out, "Work.enex"), "w", encoding="utf-8").write(enex([note("Standup", "<div>Daily at 9</div>", created="20220101T000000Z")]))

# ---- Apple Notes (a copy of your data from Apple: text files in folders), plus an HTML note with a picture written into it
zipit("icloud-notes.zip", {
    "iCloud Notes/Notes/Groceries.txt": "Groceries\nApples\nPears\n\nhttps://example.com/list",
    "iCloud Notes/Recipes/Soup.txt": "Soup\nOnions, stock.",
    "iCloud Notes/Recipes/Photo note.html": f'<html><head><title>Photo note</title></head><body><h1>Photo note</h1><p>Look:</p><img src="data:image/png;base64,{base64.b64encode(PNG).decode()}"></body></html>',
})

# ---- a bigger vault: 60 notes (several requests), one of them long and not in English (bytes, not characters, decide)
big = {f"Big/Note {i:02}.md": f"Note number {i}. Links to [[Note {(i + 1) % 60:02}]].\n" for i in range(60)}
big["Big/Long.md"] = "\n\n".join("这是一个很长的段落，用来测试导入。" * 40 for _ in range(500))
zipit("big-vault.zip", big)

# ---- loose Markdown files
open(os.path.join(out, "loose-one.md"), "w", encoding="utf-8").write("# Loose one\n\nSome **bold** words and a [link](https://example.com).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")
open(os.path.join(out, "loose-two.md"), "w", encoding="utf-8").write("Links to [[loose-one]].\n")
print("ok")
