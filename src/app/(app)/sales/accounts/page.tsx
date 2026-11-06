import type { Metadata } from "next";
import { q } from "@/lib/db";
import { COMPANY_FIELDS, PERSON_FIELDS } from "@/lib/sales/enrich";
import { AccountsView, type CompanyRow, type PersonRow } from "@/components/sales/accounts-view";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [companies, people, contacts] = await Promise.all([
    q<CompanyRow>(
      `select c.*, coalesce((select json_agg(json_build_object('id', d.id, 'title', d.title, 'stage', s.name)) from sales_deals d join sales_stages s on s.id = d.stage_id where d.company_id = c.id), '[]') as deals
       from sales_companies c order by c.updated_at desc limit 500`,
    ),
    q<PersonRow>(
      `select p.*, c.name as company_name,
         (select max(occurred_at) from sales_interactions i where i.person_id = p.id) as last_touch,
         coalesce((select json_agg(json_build_object('id', d.id, 'title', d.title, 'stage', s.name)) from sales_deals d join sales_stages s on s.id = d.stage_id
                   where d.person_id = p.id or d.id in (select deal_id from sales_deal_people where person_id = p.id)), '[]') as deals
       from sales_people p left join sales_companies c on c.id = p.company_id order by p.updated_at desc limit 800`,
    ),
    q<{ id: number; name: string; company: string | null }>("select id, name, companies[1] as company from contacts c where not exists (select 1 from sales_people p where p.contact_id = c.id) order by lower(name)"),
  ]);
  return <AccountsView companies={companies} people={people} companyFields={COMPANY_FIELDS} personFields={PERSON_FIELDS} contacts={contacts} />;
}
