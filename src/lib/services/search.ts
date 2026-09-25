/**
 * One search across everything: tasks, projects, contacts, references, diary notes and day summaries.
 * Case-insensitive substring match, a few results per group, best matches (title starts with the query) first.
 */
import { q } from "../db";
import { fmtDay, type DateStr } from "../time";

export type SearchKind = "task" | "project" | "contact" | "ref" | "diary";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const PER_GROUP = 6;

function like(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchAll(query: string): Promise<SearchHit[]> {
  const term = query.trim().slice(0, 100);
  if (term.length < 2) return [];
  const p = like(term);
  const starts = `${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const safe = <T>(promise: Promise<T[]>) => promise.catch(() => [] as T[]); // a missing optional table never breaks search
  const [tasks, projects, contacts, refs, diary] = await Promise.all([
    safe(q<{ id: number; title: string; state: string; project: string | null; due_date: DateStr | null }>(
      `select t.id, t.title, t.state, p.name as project, t.due_date from tasks t left join projects p on p.id = t.project_id
       where t.title ilike $1 or t.notes ilike $1
       order by (t.title ilike $2) desc, (t.state = 'active') desc, t.id desc limit ${PER_GROUP}`,
      [p, starts],
    )),
    safe(q<{ id: number; name: string; archived: boolean }>(
      `select id, name, archived from projects where name ilike $1 order by (name ilike $2) desc, archived, lower(name) limit ${PER_GROUP}`,
      [p, starts],
    )),
    safe(q<{ id: number; name: string; companies: string[]; cities: string[] }>(
      `select id, name, companies, cities from contacts
       where name ilike $1 or array_to_string(companies, ' ') ilike $1 or array_to_string(roles, ' ') ilike $1
          or array_to_string(cities, ' ') ilike $1 or array_to_string(tags, ' ') ilike $1 or coalesce(notes, '') ilike $1
       order by (name ilike $2) desc, lower(name) limit ${PER_GROUP}`,
      [p, starts],
    )),
    safe(q<{ id: number; title: string; kind: string; source: string | null }>(
      `select id, title, kind, source from refs
       where title ilike $1 or coalesce(body, '') ilike $1 or coalesce(url, '') ilike $1 or coalesce(source, '') ilike $1
          or array_to_string(tags, ' ') ilike $1
       order by (title ilike $2) desc, pinned desc, id desc limit ${PER_GROUP}`,
      [p, starts],
    )),
    safe(q<{ date: DateStr; text: string }>(
      `select date, text from (
         select s.date, s.headline as text, 0 as rank from diary_summaries s
         where s.headline ilike $1 or s.summary ilike $1 or s.highlights::text ilike $1
         union all
         select e.date, left(e.body, 140) as text, 1 as rank from diary_entries e where e.body ilike $1
       ) x order by date desc, rank limit ${PER_GROUP}`,
      [p],
    )),
  ]);

  return [
    ...tasks.map((t): SearchHit => ({
      kind: "task", id: `t${t.id}`, title: t.title,
      subtitle: [t.project, t.state === "active" ? null : t.state, t.due_date ? `due ${fmtDay(t.due_date)}` : null].filter(Boolean).join(" · ") || null,
      href: `/task/${t.id}`,
    })),
    ...projects.map((r): SearchHit => ({
      kind: "project", id: `p${r.id}`, title: r.name, subtitle: r.archived ? "archived" : null,
      href: `/projects?q=${encodeURIComponent(r.name)}`,
    })),
    ...contacts.map((c): SearchHit => ({
      kind: "contact", id: `c${c.id}`, title: c.name,
      subtitle: [...c.companies, ...c.cities].slice(0, 3).join(" · ") || null,
      href: `/contacts?q=${encodeURIComponent(c.name)}`,
    })),
    ...refs.map((r): SearchHit => ({
      kind: "ref", id: `r${r.id}`, title: r.title, subtitle: [r.kind, r.source].filter(Boolean).join(" · "),
      href: `/refs?q=${encodeURIComponent(r.title)}`,
    })),
    ...diary.map((d, i): SearchHit => ({
      kind: "diary", id: `d${d.date}-${i}`, title: d.text, subtitle: fmtDay(d.date), href: `/diary?date=${d.date}`,
    })),
  ];
}
