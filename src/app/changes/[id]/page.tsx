import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Timestamp } from "@/components/ui/timestamp";
import { ChangeDetails } from "@/components/changes/change-details";
import { ChangeRow } from "@/components/changes/change-rows";
import { getChangeRecord, getEventSiblings } from "@/lib/db/changes";
import { CATEGORY_LABELS, changeCategory, changeTypeLabel } from "@/lib/changes/categories";
import { severityBadgeColors } from "@/lib/utils";

const SIBLING_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One query per request, shared by the metadata and the page.
const loadChange = cache(async (id: string) => (UUID.test(id) ? getChangeRecord(id) : null));

interface ChangePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ChangePageProps): Promise<Metadata> {
  const change = await loadChange((await params).id).catch(() => null);
  if (!change) return { title: "Change not found" };
  return {
    title: `${changeTypeLabel(change.change_type)} · ${change.monitored_programs.name}`,
    description: change.change_summary,
  };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * A change's own shareable page, laid out like a security advisory: severity and
 * time under the title, the before/after next, and scannable facts on the side.
 */
export default async function ChangePage({ params }: ChangePageProps) {
  const { id } = await params;
  const change = await loadChange(id);
  if (!change) notFound();
  const loaded = await getEventSiblings(change, SIBLING_LIMIT + 1);
  const moreSiblings = loaded.length > SIBLING_LIMIT;
  const siblings = loaded.slice(0, SIBLING_LIMIT);
  const program = change.monitored_programs;
  const category = changeCategory(change.change_type);
  const details = change.change_details;
  const title = details?.itemName
    ? `${changeTypeLabel(change.change_type)}: ${details.itemName}`
    : changeTypeLabel(change.change_type);

  return (
    <Layout>
      <div className="space-y-6">
        <Link
          href={`/programs/${program.id}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {program.name}
        </Link>

        <header className="space-y-3">
          <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge className={`capitalize ${severityBadgeColors[change.severity]}`}>
              {change.severity}
            </Badge>
            <Badge variant="outline">{CATEGORY_LABELS[category]}</Badge>
            <span>
              in{" "}
              <Link
                href={`/programs/${program.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {program.name}
              </Link>
            </span>
            <span aria-hidden>·</span>
            <Timestamp value={change.detected_at} />
          </div>
          <p className="max-w-3xl text-muted-foreground">{change.change_summary}</p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">What changed</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {details ? (
                  <ChangeDetails details={details} />
                ) : (
                  <p className="text-sm text-muted-foreground">No structured details recorded.</p>
                )}
              </CardContent>
            </Card>

            {siblings.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {moreSiblings
                      ? `${SIBLING_LIMIT}+ other changes in this event`
                      : siblings.length === 1
                        ? "1 other change in this event"
                        : `${siblings.length} other changes in this event`}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul>
                    {siblings.map((sibling) => (
                      <ChangeRow key={sibling.id} change={sibling} showTime={false} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="min-w-0">
            <Card>
              <CardContent className="pt-6">
                <dl className="divide-y">
                  <Fact label="Program">
                    <Link href={`/programs/${program.id}`} className="font-medium hover:underline">
                      {program.name}
                    </Link>
                    <div className="mt-1 flex items-center gap-1">
                      <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {program.program_id}
                      </code>
                      <CopyButton
                        variant="ghost"
                        size="sm"
                        value={program.program_id}
                        copyLabel="Copy program ID"
                        copiedLabel="Copied"
                      />
                    </div>
                  </Fact>
                  <Fact label="Severity">
                    <span className="capitalize">{change.severity}</span>
                  </Fact>
                  <Fact label="Category">{CATEGORY_LABELS[category]}</Fact>
                  <Fact label="Detected">
                    <Timestamp value={change.detected_at} />
                  </Fact>
                  <Fact label="Change ID">
                    <span className="inline-flex items-center gap-1">
                      <code className="break-all font-mono text-xs">{change.id}</code>
                      <CopyButton
                        variant="ghost"
                        size="sm"
                        value={change.id}
                        copyLabel="Copy change ID"
                        copiedLabel="Copied"
                      />
                    </span>
                  </Fact>
                  <Fact label="API">
                    <a
                      href={`/api/v1/changes/${change.id}`}
                      className="font-mono text-xs underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      /api/v1/changes/{change.id.slice(0, 8)}…
                    </a>
                  </Fact>
                  <Fact label="More">
                    <Link
                      href={`/changes?programId=${encodeURIComponent(program.program_id)}`}
                      className="hover:underline"
                    >
                      All changes to {program.name}
                    </Link>
                  </Fact>
                </dl>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </Layout>
  );
}
