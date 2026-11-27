// A page's Share menu > People: share this page (and its sub-pages) with someone in the household, to view or to edit,
// and take it back. Only in your own space and only in a household (sharing.ts on the Worker checks everything).
import { useEffect, useState } from "react";
import { api, type Account, type PagePerson } from "../api";

export function SharePeople({ pageId, toast }: { pageId: string; toast: (m: string) => void }) {
  const [people, setPeople] = useState<PagePerson[] | null>(null);
  const [members, setMembers] = useState<Account[]>([]);
  const [me, setMe] = useState("");
  useEffect(() => {
    void api.pagePeople(pageId).then(setPeople).catch(() => setPeople([]));
    void api.account().then((a) => { setMe(a.user.id); setMembers(a.members); }).catch(() => undefined);
  }, [pageId]);
  const others = members.filter((m) => m.id !== me);
  if (!people || !others.length) return null;
  const level = (id: string) => people.find((p) => p.person_id === id)?.level ?? "none";
  const change = async (m: Account, to: string) => {
    try {
      setPeople(to === "none" ? await api.unsharePage(pageId, m.id) : await api.sharePage(pageId, m.id, to as "view" | "edit"));
      toast(to === "none" ? `Not shared with ${m.display_name} any more` : `${m.display_name} can ${to} this page`);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="share-people">
      <div className="mp-title">People in your household</div>
      <ul>
        {others.map((m) => (
          <li key={m.id}>
            <span className="hh-av" aria-hidden>{(m.display_name || m.username).slice(0, 1).toUpperCase()}</span>
            <span className="sp-name">{m.display_name}</span>
            <select aria-label={`${m.display_name}'s access`} value={level(m.id)} onChange={(e) => void change(m, e.target.value)}>
              <option value="none">No access</option><option value="view">Can view</option><option value="edit">Can edit</option>
            </select>
          </li>
        ))}
      </ul>
      <p className="muted">Its sub-pages come with it. They see it under "Shared with me"; nothing else of yours.</p>
    </div>
  );
}
