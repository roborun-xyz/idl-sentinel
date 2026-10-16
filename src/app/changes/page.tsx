import { Layout } from "@/components/layout/layout";
import { ChangeSummary } from "@/components/changes/change-summary";
import { ChangesList } from "@/components/changes/changes-list";

interface ChangesPageProps {
  searchParams: Promise<{
    programId?: string | string[];
  }>;
}

export default async function ChangesPage({ searchParams }: ChangesPageProps) {
  const resolvedSearchParams = await searchParams;
  const programIdParam = resolvedSearchParams.programId;
  const programId =
    typeof programIdParam === "string" ? programIdParam.trim() : programIdParam?.[0]?.trim();

  return (
    <Layout>
      <div className="space-y-6 sm:space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Changes</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {programId
              ? "IDL diffs, upgrades, authority, and multisig changes for the selected program"
              : "IDL diffs, upgrades, authority, and multisig changes across monitored programs"}
          </p>
        </div>

        {/* Change Summary Section */}
        <ChangeSummary programId={programId} />

        {/* Changes List Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold sm:text-2xl">All Changes</h2>
          <ChangesList programId={programId} />
        </div>
      </div>
    </Layout>
  );
}
