"use client";

import { useEffect, useState } from "react";
import { Layout } from "@/components/layout/layout";
import { ProgramForm } from "@/components/programs/program-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

interface EditProgramPageProps {
  params: Promise<{
    id: string;
  }>;
}

interface ProgramData {
  id: string;
  program_id: string;
  name: string;
  description?: string;
  is_active: boolean;
}

export default function EditProgramPage({ params }: EditProgramPageProps) {
  const [programId, setProgramId] = useState<string>("");
  const [program, setProgram] = useState<ProgramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => setProgramId(id));
  }, [params]);

  useEffect(() => {
    if (!programId) return;

    const fetchProgram = async () => {
      try {
        const response = await fetch(`/api/programs/${programId}`);
        const data = await response.json();

        if (response.ok) {
          setProgram(data.program);
        } else {
          if (response.status === 404) {
            setError("Program not found");
          } else {
            setError(data.error || "Failed to load program");
          }
        }
      } catch (err) {
        console.error("Error fetching program:", err);
        setError("Failed to load program");
      } finally {
        setLoading(false);
      }
    };

    fetchProgram();
  }, [programId]);

  if (loading) {
    return (
      <Layout>
        <div className="space-y-8">
          <div>
            <Skeleton className="mb-2 h-9 w-48" />
            <Skeleton className="h-5 w-96" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </Layout>
    );
  }

  if (error || !program) {
    return (
      <Layout>
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Program</h1>
          </div>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error || "Program not found"}</AlertDescription>
          </Alert>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Program</h1>
          <p className="text-muted-foreground">Update the details for {program.name}</p>
        </div>

        <ProgramForm
          initialData={{
            program_id: program.program_id,
            name: program.name,
            description: program.description || "",
            is_active: program.is_active,
          }}
          programId={program.id}
          isEdit={true}
        />
      </div>
    </Layout>
  );
}
