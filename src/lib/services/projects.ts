import { q } from "../db";
import type { DateStr } from "../time";

export interface ProjectSummary {
  id: number;
  name: string;
  color: string;
  activeTasks: number;
  doneTasks: number;
  droppedTasks: number;
  completionPct: number | null;
}

export interface ProjectTask {
  id: number;
  title: string;
  type: string;
  state: string;
  estimateMin: number | null;
  dueDate: string | null;
  carry: number;
  lastDoneAt: Date | null;
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const rows = await q<{
    id: number;
    name: string;
    color: string;
    active: number;
    done: number;
    dropped: number;
  }>(
    `select p.id, p.name, p.color,
       count(*) filter (where t.state = 'active')::int as active,
       count(*) filter (where t.state = 'done')::int as done,
       count(*) filter (where t.state = 'dropped')::int as dropped
     from projects p
     left join tasks t on t.project_id = p.id and t.type <> 'someday'
     where p.archived = false
     group by p.id, p.name, p.color
     order by lower(p.name)`,
    [],
  );
  return rows.map((r) => {
    const total = r.active + r.done;
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      activeTasks: r.active,
      doneTasks: r.done,
      droppedTasks: r.dropped,
      completionPct: total > 0 ? Math.round((r.done / total) * 100) : null,
    };
  });
}

export async function listTasksForProject(projectId: number): Promise<ProjectTask[]> {
  const rows = await q<{
    id: number;
    title: string;
    type: string;
    state: string;
    estimate_min: number | null;
    due_date: DateStr | null;
    carry_count: number;
    last_done_at: Date | null;
  }>(
    `select id, title, type, state, estimate_min, due_date, carry_count, last_done_at
     from tasks where project_id = $1 and type <> 'someday'
     order by state = 'active' desc, carry_count desc, id desc`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    state: r.state,
    estimateMin: r.estimate_min,
    dueDate: r.due_date,
    carry: r.carry_count,
    lastDoneAt: r.last_done_at,
  }));
}

export async function projectProgressForStats(
  from: DateStr,
  to: DateStr,
): Promise<{ id: number; name: string; color: string; totalTasks: number; doneTasks: number; completionPct: number }[]> {
  const rows = await q<{
    id: number;
    name: string;
    color: string;
    total: number;
    done: number;
  }>(
    `select p.id, p.name, p.color,
       count(distinct t.id) filter (where t.state in ('active','done'))::int as total,
       count(distinct t.id) filter (where t.state = 'done' and t.closed_at::date between $1 and $2)::int as done
     from projects p
     join tasks t on t.project_id = p.id and t.type <> 'someday'
     where p.archived = false
     group by p.id, p.name, p.color
     having count(distinct t.id) filter (where t.state in ('active','done')) > 0
     order by count(distinct t.id) filter (where t.state = 'done' and t.closed_at::date between $1 and $2) desc, lower(p.name)`,
    [from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    totalTasks: r.total,
    doneTasks: r.done,
    completionPct: r.total > 0 ? Math.round((r.done / r.total) * 100) : 0,
  }));
}
