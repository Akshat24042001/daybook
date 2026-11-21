import type { Metadata } from "next";
import { q, one } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { calendarDate } from "@/lib/time";
import { mdToHtml } from "@/lib/sales/md";
import { seedNewsSources, TOPICS } from "@/lib/news/sources";
import { NewsView, type NewsStory, type NewsSourceView, type EditionListItem } from "@/components/news/news-view";

export const metadata: Metadata = { title: "News" };
export const dynamic = "force-dynamic";

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await seedNewsSources();
  const tz = (await getSettings()).timezone;
  const today = calendarDate(new Date(), tz);
  const want = (await searchParams).date;
  const [editions, stories, sources, settings] = await Promise.all([
    q<EditionListItem>("select to_char(date, 'YYYY-MM-DD') as date, title, stories, sent_at from news_editions order by date desc limit 90"),
    q<NewsStory>(
      `select id, title, url, outlet, summary, score, coalesce(topic, 'other') as topic, why, action, starred, to_char(coalesce(published_at, found_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
       from news_items where found_at > now() - interval '3 days' and (score is null or score >= 40) order by score desc nulls last, found_at desc limit 300`),
    q<NewsSourceView>("select id, name, kind, topic, enabled, custom, last_ok_at, last_error, items_found from news_sources order by custom desc, topic, name"),
    one<{ enabled: boolean; send_hour: number; telegram: boolean; pdf: boolean; extra_interests: string }>("select enabled, send_hour, telegram, pdf, extra_interests from news_settings where id = 1"),
  ]);
  const date = want && /^\d{4}-\d{2}-\d{2}$/.test(want) ? want : editions[0]?.date ?? null;
  const edition = date ? await one<{ date: string; title: string; markdown: string; stories: number; sent_at: string | null }>(
    "select to_char(date, 'YYYY-MM-DD') as date, title, markdown, stories, sent_at from news_editions where date = $1", [date]) : null;
  return (
    <NewsView
      today={today} tz={tz} editions={editions} stories={stories} sources={sources} topics={TOPICS}
      edition={edition ? { ...edition, html: mdToHtml(edition.markdown) } : null}
      settings={settings ?? { enabled: true, send_hour: 8, telegram: true, pdf: true, extra_interests: "" }}
    />
  );
}
