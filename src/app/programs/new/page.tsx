import { Layout } from "@/components/layout/layout";
import { ProgramForm } from "@/components/programs/program-form";
import { getProgramActivationFeeQuote } from "@/lib/db/payments";

function activationFeeUsdc(): number {
  try {
    return getProgramActivationFeeQuote().feeUsdc;
  } catch {
    return 5;
  }
}

export default function NewProgramPage() {
  const feeUsdc = activationFeeUsdc();

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Program</h1>
          <p className="text-muted-foreground">
            Preview the on-chain IDL first. Programs that are already monitored can be watched for
            free; new programs are activated with a one-time {feeUsdc} USDC payment.
          </p>
        </div>

        <ProgramForm />
      </div>
    </Layout>
  );
}
