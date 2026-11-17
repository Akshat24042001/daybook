/**
 * One search across everything: tasks, projects, contacts, references, diary notes, day summaries, scratchpad items,
 * and sales: deals, radar leads, companies and people. Case-insensitive substring match, a few results per group, best
 * matches (title starts with the query) first. Sales match on every word in any field (find.ts), chats and notes included.
 */
import { q } from "../db";
import { itemPreview, KIND_META, type ScratchData, type ScratchKind } from "../scratch";
import { fmtDay, type DateStr } from "../time";
import { searchDeals, searchRadar } from "../sales/find";

export type SearchKind = "task" | "project" | "contact" | "ref" | "diary" | "scratch" | "deal" | "lead" | "company" | "person";

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
  const [tasks, projects, contacts, refs, diary, scratch, deals, leads, companies, people] = await Promise.all([
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
    // only the words people wrote: note text, calculator lines, graph functions, text placed on sketches
    safe(q<{ id: number; date: DateStr; kind: ScratchKind; title: string; data: ScratchData }>(
      `select id, date, kind, title, data from scratch_items
       where title ilike $1
          or (kind = 'note' and data->>'text' ilike $1)
          or (kind = 'calc' and (data->'lines')::text ilike $1)
          or (kind = 'graph' and (data->'fns')::text ilike $1)
          or (kind = 'sketch' and jsonb_path_query_array(data, '$.strokes[*].x')::text ilike $1)
          or (kind = 'checklist' and jsonb_path_query_array(data, '$.items[*].text')::text ilike $1)
          or (kind = 'table' and (data->'rows')::text ilike $1)
          or (kind = 'link' and (data->>'url' ilike $1 or data->>'note' ilike $1))
          or (kind = 'code' and data->>'code' ilike $1)
          or (kind in ('file','voice') and (data->>'name' ilike $1 or data->>'transcript' ilike $1))
       order by date desc, id desc limit ${PER_GROUP}`,
      [p],
    )),
    safe(searchDeals(term, PER_GROUP)),
    safe(searchRadar(term, PER_GROUP)),
    safe(q<{ id: number; name: string; industry: string | null; city: string | null; country: string | null; website: string | null }>(
      `select id, name, industry, city, country, website from sales_companies
       where to_jsonb(sales_companies)::text ilike $1
       order by (name ilike $2) desc, lower(name) limit ${PER_GROUP}`,
      [p, starts],
    )),
    safe(q<{ id: number; full_name: string; title: string | null; company: string | null; deal_id: number | null }>(
      `select p.id, p.full_name, p.title, c.name as company,
              (select d.id from sales_deals d where d.person_id = p.id order by d.updated_at desc limit 1) as deal_id
       from sales_people p left join sales_companies c on c.id = p.company_id
       where concat_ws(' ', to_jsonb(p)::text, c.name) ilike $1
       order by (p.full_name ilike $2) desc, lower(p.full_name) limit ${PER_GROUP}`,
      [p, starts],
    )),
  ]);

  return [
    ...deals.map((d): SearchHit => ({
      kind: "deal", id: `deal${d.id}`, title: d.title,
      subtitle: [d.stage, d.company, d.person].filter(Boolean).join(" · ") || null, href: `/sales/deal/${d.id}`,
    })),
    ...leads.map((l): SearchHit => ({
      kind: "lead", id: `lead${l.id}`, title: l.title, subtitle: [l.score !== null ? `score ${l.score}` : null, l.status].filter(Boolean).join(" · "),
      href: `/sales/radar?lead=${l.id}`,
    })),
    ...companies.map((c): SearchHit => ({
      kind: "company", id: `co${c.id}`, title: c.name, subtitle: [c.industry, c.city, c.country].filter(Boolean).join(" · ") || c.website,
      href: `/sales/accounts?tab=companies&q=${encodeURIComponent(c.name)}`,
    })),
    ...people.map((x): SearchHit => ({
      kind: "person", id: `pe${x.id}`, title: x.full_name, subtitle: [x.title, x.company].filter(Boolean).join(" · ") || null,
      href: x.deal_id ? `/sales/deal/${x.deal_id}` : `/sales/accounts?q=${encodeURIComponent(x.full_name)}`,
    })),
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
    ...scratch.map((s): SearchHit => ({
      kind: "scratch", id: `s${s.id}`, title: s.title || itemPreview(s.kind, s.data) || `Untitled ${KIND_META[s.kind].noun}`,
      subtitle: `${KIND_META[s.kind].label} · ${fmtDay(s.date)}`, href: `/scratch?date=${s.date}`,
    })),
  ];
}
