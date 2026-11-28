// Settings > Import from other apps (0.2.4): pick the app, read how to export from it, choose the file or folder, see what
// was found, then import. Everything lands in one new page, so moving or deleting the whole import is one step.
// The reading happens on this device (client/import/); pages are made by the Worker like any other page.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { APPS, build, detect, gather, type App, type ImpSet } from "../import/sources";
import { rootTitle, runImport, type Result } from "../import/run";
import { IClose, IUpload } from "../ui-icons";

const HOW: Record<App, { steps: string; accept: string; folder?: boolean }> = {
  notion: { steps: "In Notion, open Settings, then General, and choose Export all workspace content (or use a page's ••• menu > Export). Pick Markdown & CSV, include sub-pages, then choose the .zip here.", accept: ".zip" },
  obsidian: { steps: "Choose your vault's folder, or a .zip of it. [[Links]] become links to the imported pages, and pictures and attachments come along.", accept: ".zip,.md,.markdown", folder: true },
  markdown: { steps: "Choose a folder or a .zip of .md, .txt or .html files, or just a few files. Each folder becomes a page holding its notes.", accept: ".zip,.md,.markdown,.txt,.html,.htm", folder: true },
  apple: { steps: "Apple Notes can't export everything at once. Ask Apple for a copy at privacy.apple.com (Request a copy of your data, then iCloud Notes) and choose that .zip, or export notes as Markdown or HTML with an app such as Exporter and choose the folder.", accept: ".zip,.txt,.html,.htm,.md", folder: true },
  keep: { steps: "Go to takeout.google.com, choose Deselect all, tick Keep, and export once as a .zip. Choose that .zip here. Notes in Keep's trash are left out.", accept: ".zip,.json" },
  evernote: { steps: "In Evernote, open a notebook's menu and choose Export notebook, as ENEX (.enex). Choose one or more .enex files here; each notebook becomes a page.", accept: ".enex" },
};
const ORDER: App[] = ["notion", "obsidian", "markdown", "apple", "keep", "evernote"];

type Stage = { at: "pick" } | { at: "reading" } | { at: "ready"; set: ImpSet; files: number } | { at: "going"; step: string; done: number; total: number } | { at: "done"; r: Result } | { at: "stopped"; rootId: string };

export function ImportDialog() {
  const s = useStore();
  const [app, setApp] = useState<App>("notion");
  const [stage, setStage] = useState<Stage>({ at: "pick" });
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const busy = stage.at === "reading" || stage.at === "going";
  const close = () => { if (!busy) s.setImportOpen(false); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });
  useEffect(() => { dirRef.current?.setAttribute("webkitdirectory", ""); }, [stage.at]);

  const read = async (list: File[]) => {
    if (!list.length) return;
    setError(""); setStage({ at: "reading" });
    try {
      const srcs = await gather(list);
      const found = await detect(srcs);
      // Folders of files read the same way whichever app made them; the app picked only names the import.
      const files: App[] = ["obsidian", "markdown", "apple"];
      const set = await build(srcs, files.includes(found) && files.includes(app) ? app : found);
      if (!set.pages.length) throw new Error("No notes were found there. Check it's the export described above.");
      setStage({ at: "ready", set, files: set.files.size });
    } catch (e) { setError((e as Error).message); setStage({ at: "pick" }); }
  };
  const go = async (set: ImpSet) => {
    setStage({ at: "going", step: "Starting", done: 0, total: 1 });
    try {
      const r = await runImport(set, (step, done, total) => setStage({ at: "going", step, done, total }), set.app === app ? undefined : APPS[set.app]);
      await s.refreshTree();
      setStage({ at: "done", r });
    } catch (e) {
      const part = (e as Error & { rootId?: string | null }).rootId;
      await s.refreshTree();
      setError(`The import stopped: ${(e as Error).message}`);
      setStage(part ? { at: "stopped", rootId: part } : { at: "pick" });
    }
  };
  const undo = async (r: Result) => {
    try { await api.trash(r.rootId); await s.refreshTree(); s.toast("The import is in the trash"); s.setImportOpen(false); } catch (e) { s.toast((e as Error).message); }
  };

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal importer" role="dialog" aria-label="Import from other apps" onMouseDown={(e) => e.stopPropagation()}
        onDragOver={(e) => { if (stage.at === "pick") e.preventDefault(); }}
        onDrop={(e) => { if (stage.at !== "pick") return; e.preventDefault(); void read([...e.dataTransfer.files]); }}>
        <div className="memory-head">
          <span className="notify-ico"><IUpload size={22} /></span>
          <div><b>Import from other apps</b><small>Everything goes into one new page, so you can move it or delete it in one go. Your files are read on this device.</small></div>
          <button className="ghost icon-btn" aria-label="Close" disabled={busy} onClick={close}><IClose size={18} /></button>
        </div>

        {stage.at === "pick" && <>
          <div className="imp-apps" role="radiogroup" aria-label="Where from">
            {ORDER.map((a) => <button key={a} role="radio" aria-checked={app === a} className={app === a ? "on" : ""} onClick={() => { setApp(a); setError(""); }}>{APPS[a]}</button>)}
          </div>
          <p className="imp-how">{HOW[app].steps}</p>
          {error && <p className="imp-error" role="alert">{error}</p>}
          <div className="dlg-actions">
            <button className="primary" onClick={() => fileRef.current?.click()}>Choose {HOW[app].accept === ".enex" ? "files" : HOW[app].accept === ".zip" ? "the .zip" : "a file"}</button>
            {HOW[app].folder && <button onClick={() => dirRef.current?.click()}>Choose a folder</button>}
          </div>
          <small className="muted imp-drop">You can also drop it here.</small>
          <input ref={fileRef} type="file" hidden multiple accept={HOW[app].accept} aria-label="Export file" onChange={(e) => { void read([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <input ref={dirRef} type="file" hidden multiple aria-label="Export folder" onChange={(e) => { void read([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </>}

        {stage.at === "reading" && <div className="imp-state"><span>Reading the export…</span><div className="imp-bar"><i style={{ width: "30%" }} className="indet" /></div></div>}

        {stage.at === "ready" && (() => {
          const { set } = stage;
          const pages = set.pages.filter((p) => p.kind !== "database").length, dbs = set.pages.length - pages;
          return <>
            <div className="imp-state">
              <span>{set.app !== app ? `This looks like a ${APPS[set.app]} export. ` : ""}Found {pages} page{pages === 1 ? "" : "s"}{dbs ? `, ${dbs} database${dbs === 1 ? "" : "s"}` : ""}{stage.files ? ` and ${stage.files} picture${stage.files === 1 ? "" : "s"} or file${stage.files === 1 ? "" : "s"}` : ""}.</span>
              <small>They'll go into a new page, “{rootTitle(set, set.app === app ? undefined : APPS[set.app])}”.</small>
            </div>
            <div className="dlg-actions">
              <button onClick={() => setStage({ at: "pick" })}>Back</button>
              <button className="primary" onClick={() => void go(set)}>Import</button>
            </div>
          </>;
        })()}

        {stage.at === "going" && (
          <div className="imp-state" aria-live="polite">
            <span>{stage.step}{stage.total > 1 ? ` (${stage.done} of ${stage.total})` : ""}…</span>
            <div className="imp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={stage.total} aria-valuenow={stage.done}><i style={{ width: `${Math.round((stage.done / Math.max(1, stage.total)) * 100)}%` }} /></div>
            <small>Keep this open until it finishes.</small>
          </div>
        )}

        {stage.at === "stopped" && <>
          <p className="imp-error" role="alert">{error}</p>
          <p className="imp-how">Some pages were made before it stopped. Remove them, or keep them and look at what came in.</p>
          <div className="dlg-actions">
            <button onClick={() => { setError(""); setStage({ at: "pick" }); }}>Keep them</button>
            <button className="primary" onClick={() => void undo({ rootId: stage.rootId } as Result)}>Remove what was imported</button>
          </div>
        </>}

        {stage.at === "done" && <>
          <div className="imp-state">
            <span>Imported {stage.r.pages} page{stage.r.pages === 1 ? "" : "s"}{stage.r.files ? ` and ${stage.r.files} file${stage.r.files === 1 ? "" : "s"}` : ""} into “{stage.r.title}”.</span>
            {stage.r.skipped.length > 0 && (
              <details className="imp-skipped"><summary>{stage.r.skipped.length} thing{stage.r.skipped.length === 1 ? "" : "s"} couldn't come along</summary>
                <ul>{stage.r.skipped.slice(0, 200).map((x, i) => <li key={i}>{x}</li>)}</ul>
              </details>
            )}
          </div>
          <div className="dlg-actions">
            <button onClick={() => void undo(stage.r)}>Undo import</button>
            <button className="primary" onClick={() => { s.setImportOpen(false); s.go(`/p/${stage.r.rootId}`); }}>Open it</button>
          </div>
        </>}
      </div>
    </div>
  );
}
