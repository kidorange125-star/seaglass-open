# Importing from other apps

Settings > **Import from other apps**. Pick the app, export from it as described below, then choose the file or folder
(or drop it on the dialog). Seaglass shows what it found before anything is saved. Everything goes into one new page,
"Imported from …", so you can move it anywhere or delete the whole import in one step (**Undo import**, or move that
page to the trash). In the Family space, the import goes into the Family space.

Your export is read on your own device. Only the pages, pictures and files that come out of it are sent to your
Seaglass, the same way as if you'd typed them in. Nothing is sent to the AI.

| From | How to export | What comes along |
|---|---|---|
| **Notion** | Settings > General > *Export all workspace content*, or a page's ••• menu > *Export*. Choose **Markdown & CSV** and include sub-pages. Choose the .zip. | Pages and sub-pages in their places, pictures and files, links between pages (as page mentions). Each database becomes a Seaglass database: its columns become properties (numbers, dates, checkboxes, and choices for columns such as Status or Tags), and its rows keep their own pages. |
| **Obsidian** | Choose the vault's folder, or a .zip of it. | Folders as pages holding their notes (a folder note becomes the folder's page), `[[links]]` and `![[embeds]]`, pictures and attachments, `==highlights==`, checklists, front matter shown at the top of the note, `created` dates. |
| **Markdown** | A folder or .zip of .md, .txt or .html files, or a few files. | The same as Obsidian. A CSV becomes a database. |
| **Apple Notes** | Apple Notes can't export everything itself. Ask Apple for a copy at privacy.apple.com (*Request a copy of your data* > iCloud Notes) and choose that .zip, or export notes to Markdown or HTML with an app such as Exporter. | Folders as pages, each note's text (or HTML, with pictures), attachments next to the notes. |
| **Google Keep** | takeout.google.com > *Deselect all* > tick **Keep** > export once as a **.zip**. | Notes with checklists, labels, pictures, links and their dates. Archived notes go in a page called Archived; notes in Keep's trash are left out. |
| **Evernote** | A notebook's menu > *Export notebook* > **ENEX**. Choose one or more .enex files. | A page per notebook, each note with its checkboxes, pictures and files, tags, source link and dates. Encrypted text can't be read and is marked. |

## Good to know

- **Pictures and files** must be ones Seaglass keeps: pictures (PNG, JPEG, GIF, WebP, AVIF), PDFs, audio and video,
  25 MB each at most. Anything else (Word files, for example) is listed at the end as not imported. Pictures written
  into a note (`data:` addresses) are saved as files, so pages stay small.
- **Attachments no note shows** still come along, under a "Files" heading on the page of their folder.
- **A very long page** (over about 600 KB of text and formatting, which is a whole book) is imported up to that point,
  with a note saying the rest didn't fit, and it's listed at the end.
- **If a few pages can't be saved**, the rest still are: pages go in small groups, and a group that fails is tried again
  in smaller parts, so only the page that can't be saved is left out (and listed).
- **Things that can't come along** are listed at the end of the import, so nothing goes missing quietly.
- **If an import stops part way**, you can remove what came in, or keep it.

## How it was tested

`tests/browser/import.cjs` imports exports built by `tests/browser/import-fixtures.py` in the shapes these apps write
(file names, folders, CSVs, JSON fields, ENEX and ENML, zips inside zips, Zip64), and checks every page through the API.
They are made to match the formats; they aren't copies of real exports. If an export from one of these apps doesn't
come in right, please open an issue with what you see (not the export itself, which holds your notes).

## For developers

- `src/client/import/`: `zip.ts` (a small zip reader using the browser's DecompressionStream), `md5.ts` (Evernote finds
  pictures by MD5), `convert.ts` (Markdown, HTML and text to page HTML with placeholders), `sources.ts` (each app's
  export to pages), `run.ts` (uploads, links, and sending the pages).
- `src/worker/importer.ts` and `POST /api/import/pages`: up to 25 pages per request, parents first, made by
  `notes.ts createMany` in one database batch (the free plan allows 50 database calls per request), sanitized, logged in
  version history and the change feed under one run id.
