import { ArrowLeft, Dumbbell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ExerciseTypes } from "@/components/health/exercise-types";
import { PageHeader } from "@/components/page-header";
import { listExerciseTypes } from "@/lib/services/health";

export const metadata: Metadata = { title: "Exercise library" };
export const dynamic = "force-dynamic";

export default async function ExerciseLibraryPage() {
  const types = await listExerciseTypes(false);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon={Dumbbell}
        hue="teal"
        title="Exercise library"
        subtitle="Name, default amount and unit. The bot starts each ping from the last one you used."
        actions={<Link href="/health" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-subtle hover:text-fg"><ArrowLeft className="h-4 w-4" /> Health</Link>}
      />
      <ExerciseTypes types={types.map((t) => ({ id: t.id, name: t.name, defaultAmount: t.default_amount, unit: t.unit, active: t.active }))} />
    </div>
  );
}
