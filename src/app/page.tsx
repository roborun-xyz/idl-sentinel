import { Layout } from "@/components/layout/layout";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { RecentChanges } from "@/components/dashboard/recent-changes";
import { MonitoredPrograms } from "@/components/dashboard/monitored-programs";
import {
  FeatureGrid,
  Hero,
  HowItWorks,
  Pricing,
  WhatGetsFlagged,
} from "@/components/landing/landing-sections";
import { getProgramActivationFeeQuote } from "@/lib/db/payments";

function activationFeeUsdc(): number {
  try {
    return getProgramActivationFeeQuote().feeUsdc;
  } catch {
    return 5;
  }
}

export default function Home() {
  const feeUsdc = activationFeeUsdc();

  return (
    <Layout>
      <div className="space-y-12 sm:space-y-16">
        <Hero />

        <section className="space-y-6">
          <StatsCards />
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            <RecentChanges />
            <MonitoredPrograms />
          </div>
        </section>

        <HowItWorks />
        <WhatGetsFlagged />
        <FeatureGrid />
        <Pricing feeUsdc={feeUsdc} />
      </div>
    </Layout>
  );
}
