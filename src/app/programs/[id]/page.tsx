import { Layout } from "@/components/layout/layout";
import { ProgramDetail } from "@/components/programs/program-detail";

interface ProgramDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProgramDetailPage({ params }: ProgramDetailPageProps) {
  const { id } = await params;

  return (
    <Layout>
      <ProgramDetail programId={id} />
    </Layout>
  );
}
