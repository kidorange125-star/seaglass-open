// A small pill while there's no connection (or edits are waiting to sync), so it's clear nothing is lost.
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { flushQueue, queuedCount } from "../offline";
import { useStore } from "../store";

export function OfflineBadge() {
  const s = useStore();
  const [online, setOnline] = useState(navigator.onLine);
  const [n, setN] = useState(queuedCount());
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false), q = () => setN(queuedCount());
    addEventListener("online", on); addEventListener("offline", off); addEventListener("seaglass:queue", q);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); removeEventListener("seaglass:queue", q); };
  }, []);
  if (online && !n) return null;
  return (
    <div className={`offline-badge ${online ? "syncing" : ""}`} role="status">
      {online ? <RefreshCw size={14} /> : <CloudOff size={14} />}
      <span>{online ? `Syncing ${n} change${n === 1 ? "" : "s"}…` : n ? `Offline · ${n} change${n === 1 ? "" : "s"} saved on this device` : "Offline · you can read and edit your pages"}</span>
      {online && <button className="ghost" onClick={() => void flushQueue((m) => s.toast(m))}>Retry</button>}
    </div>
  );
}
