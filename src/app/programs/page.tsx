import { Layout } from "@/components/layout/layout";
import { ProgramsList } from "@/components/programs/programs-list";

export default function ProgramsPage() {
  return (
    <Layout>
      <div className="space-y-6 sm:space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Programs</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Add, watch, and monitor Solana programs for IDL, code, and authority changes
          </p>
        </div>

        <ProgramsList />
      </div>
    </Layout>
  );
}
