import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BellRing,
  Blocks,
  Coins,
  Diff,
  Eye,
  GitCompareArrows,
  LockKeyhole,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RepositoryLink } from "@/components/layout/repository-link";
import { severityDotColors } from "@/lib/utils";

const POLL_INTERVAL_MINUTES = 15;

export function Hero() {
  return (
    <section className="space-y-6 pt-2 text-center sm:pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        IDL change monitoring for Solana
      </p>
      <h1 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
        Know when a program&apos;s interface changes before your integration breaks.
      </h1>
      <p className="mx-auto max-w-2xl px-2 text-base text-muted-foreground sm:text-lg">
        IDL Sentinel polls on-chain Anchor and Program Metadata IDLs every {POLL_INTERVAL_MINUTES}{" "}
        minutes, keeps every version, classifies the diff by severity, and alerts your Slack or
        Telegram when instructions, accounts, types, or errors change.
      </p>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/programs/new">
            <Plus className="h-4 w-4" />
            Monitor a program
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/programs">
            Browse monitored programs
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

const steps = [
  {
    icon: Blocks,
    title: "Register a program",
    body: "Paste a program ID. IDL Sentinel discovers the on-chain IDL, previews its instructions and accounts, and stores the first snapshot.",
  },
  {
    icon: Eye,
    title: "Watch it",
    body: "Add the program to your watchlist and connect Slack or Telegram from Settings. Watching an already-registered program is free.",
  },
  {
    icon: BellRing,
    title: "Get a diff, not a hash",
    body: "Each alert names what changed and how severe it is. Open the program page to compare any two versions side by side or download the JSON.",
  },
];

export function HowItWorks() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="How it works"
        subtitle="From program ID to actionable alert in three steps."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <Card key={step.title}>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted/40 font-mono text-xs text-muted-foreground">
                    0{index + 1}
                  </span>
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <h3 className="font-semibold">{step.title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

const severities = [
  {
    level: "critical" as const,
    examples: "Instruction removed, signer requirement or discriminator changed, IDL disappeared.",
  },
  {
    level: "high" as const,
    examples:
      "Account or type removed, account layout changed, instruction arguments or mutability changed.",
  },
  {
    level: "medium" as const,
    examples:
      "Other instruction edits, type modifications, error removed, new initialize/withdraw/close style instructions.",
  },
  {
    level: "low" as const,
    examples: "New instructions, accounts, types, or errors; error names or messages reworded.",
  },
];

export function WhatGetsFlagged() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="What gets flagged"
        subtitle="Every change is classified so you can route critical alerts differently from routine additions."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {severities.map((item) => (
          <Card key={item.level}>
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-sm ${severityDotColors[item.level]}`}
                  aria-hidden="true"
                />
                <span className="text-sm font-semibold capitalize">{item.level}</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{item.examples}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

interface PricingProps {
  feeUsdc: number;
}

export function Pricing({ feeUsdc }: PricingProps) {
  const fee = Number.isInteger(feeUsdc) ? feeUsdc.toString() : feeUsdc.toFixed(2);
  return (
    <section className="space-y-6">
      <SectionHeading
        title="Simple pricing"
        subtitle="Pay once to register a program. Everyone can watch it after that."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Coins className="h-4 w-4" aria-hidden="true" />
                New program activation
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight">{fee} USDC</span>
                <span className="text-sm text-muted-foreground">one time, per program</span>
              </div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Paid on Solana with your connected wallet. No subscription, no card.</li>
                <li>
                  Covers the shared registry entry, snapshot history, and alerts for every watcher.
                </li>
                <li>Already registered programs are free to watch.</li>
              </ul>
            </div>
            <Button asChild>
              <Link href="/programs/new">
                Check a program ID
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Open source
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Read the detector rules, audit the payment flow, or run your own instance with your
              own RPC and treasury.
            </p>
            <RepositoryLink className="inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline">
              View the source
            </RepositoryLink>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

const features = [
  {
    icon: GitCompareArrows,
    title: "Anchor and Program Metadata",
    body: "Reads legacy Anchor IDL accounts and the newer Program Metadata idl entries, inline, URL-referenced, or in external accounts.",
  },
  {
    icon: Diff,
    title: "Full version history",
    body: "Every distinct IDL is kept as a snapshot with its hash and timestamp. Rollbacks show up as new versions, not silent no-ops.",
  },
  {
    icon: ShieldAlert,
    title: "Removal detection",
    body: "A confirmed missing IDL is a critical alert. RPC hiccups are retried and logged instead of raising false alarms.",
  },
  {
    icon: Bell,
    title: "Reliable delivery",
    body: "Per-recipient delivery receipts and bounded retries mean a flaky webhook does not drop the alert for everyone else.",
  },
];

export function FeatureGrid() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="Built for teams that ship against other people's programs"
        subtitle="Integrators, wallets, indexers, and auditors depend on interfaces they do not control."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card key={feature.title}>
              <CardContent className="space-y-2 p-5">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <h3 className="text-sm font-semibold">{feature.title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      <p className="text-sm text-muted-foreground sm:text-base">{subtitle}</p>
    </div>
  );
}
