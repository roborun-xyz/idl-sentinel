"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { Check, Eye, EyeOff, Loader2, RotateCw, Save, TestTube, X } from "lucide-react";
import { useTestIntegration, useUpdateSettings, useUserSettings } from "@/hooks/use-user-settings";

type Severity = "low" | "medium" | "high" | "critical";
type Status = { kind: "ok" | "error"; text: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      className={`mt-2 flex items-center text-sm ${status.kind === "ok" ? "text-green-600" : "text-destructive"}`}
    >
      {status.kind === "ok" ? <Check className="mr-1 h-4 w-4" /> : <X className="mr-1 h-4 w-4" />}
      {status.text}
    </p>
  );
}

const SIGNATURE_SNIPPET = `const expected = "v1=" + crypto
  .createHmac("sha256", secret)
  .update(\`\${req.headers["x-idl-sentinel-timestamp"]}.\${rawBody}\`)
  .digest("hex");
// Compare with req.headers["x-idl-sentinel-signature"] using timingSafeEqual,
// and reject timestamps older than five minutes.`;

/** Signed JSON webhooks and PagerDuty: delivery for automation and on-call. */
export function IntegrationSettings() {
  const { data } = useUserSettings();
  const settings = data?.user;
  const update = useUpdateSettings();
  const test = useTestIntegration();

  const [webhookDraft, setWebhookDraft] = useState<string | null>(null);
  const [routingDraft, setRoutingDraft] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<Status>(null);
  const [pagerStatus, setPagerStatus] = useState<Status>(null);

  const webhookUrl = webhookDraft ?? settings?.webhook_url ?? "";
  const routingKey = routingDraft ?? settings?.pagerduty_routing_key ?? "";
  const minSeverity: Severity = settings?.pagerduty_min_severity ?? "high";
  const busy = update.isPending || test.isPending;

  async function run(setStatus: (s: Status) => void, action: () => Promise<string>) {
    setStatus(null);
    try {
      setStatus({ kind: "ok", text: await action() });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Request failed" });
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-2 text-xl font-semibold">Integrations</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        For automation and on-call. Upgrade, authority, multisig, and verification alerts go here
        too.
      </p>

      <div className="space-y-8">
        <section>
          <label htmlFor="webhook-url" className="mb-2 block text-sm font-medium">
            Signed webhook
          </label>
          <p className="mb-3 text-xs text-muted-foreground">
            We POST JSON for every alert batch, signed with HMAC-SHA256 over the timestamp and body.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="webhook-url"
              type="url"
              placeholder="https://example.com/hooks/idl-sentinel"
              value={webhookUrl}
              onChange={(e) => setWebhookDraft(e.target.value)}
              className="flex-1 font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(setWebhookStatus, async () => {
                    await update.mutateAsync({ webhook_url: webhookUrl.trim() || null });
                    setWebhookDraft(null);
                    return webhookUrl.trim() ? "Webhook saved" : "Webhook removed";
                  })
                }
              >
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
              <Button
                variant="outline"
                disabled={busy || !settings?.webhook_url || webhookDraft !== null}
                onClick={() =>
                  run(setWebhookStatus, async () => (await test.mutateAsync("webhook")).message)
                }
              >
                {test.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="mr-2 h-4 w-4" />
                )}
                Test
              </Button>
            </div>
          </div>
          {settings?.webhook_secret && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Signing secret</span>
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                  {showSecret ? settings.webhook_secret : "whsec_••••••••••••••••"}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSecret(!showSecret)}
                  aria-label="Toggle secret"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <CopyButton
                  variant="ghost"
                  size="sm"
                  value={settings.webhook_secret}
                  copyLabel="Copy secret"
                  copiedLabel="Copied"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !confirm(
                        "Rotate the signing secret? Your receiver must switch to the new one."
                      )
                    )
                      return;
                    run(setWebhookStatus, async () => {
                      await update.mutateAsync({ rotate_webhook_secret: true });
                      setShowSecret(true);
                      return "Secret rotated";
                    });
                  }}
                >
                  <RotateCw className="mr-1 h-4 w-4" /> Rotate
                </Button>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Verify the signature (Node.js)
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono">
                  {SIGNATURE_SNIPPET}
                </pre>
              </details>
            </div>
          )}
          <StatusLine status={webhookStatus} />
        </section>

        <section>
          <label htmlFor="pagerduty-key" className="mb-2 block text-sm font-medium">
            PagerDuty
          </label>
          <p className="mb-3 text-xs text-muted-foreground">
            Paste an Events API v2 integration (routing) key. Only alerts at or above the threshold
            page.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="pagerduty-key"
              placeholder="32-character routing key"
              value={routingKey}
              onChange={(e) => setRoutingDraft(e.target.value)}
              className="flex-1 font-mono text-sm"
              autoComplete="off"
            />
            <select
              aria-label="Minimum severity that pages"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={minSeverity}
              disabled={busy}
              onChange={(e) =>
                run(setPagerStatus, async () => {
                  await update.mutateAsync({ pagerduty_min_severity: e.target.value as Severity });
                  return `Pages on ${e.target.value} and above`;
                })
              }
            >
              <option value="critical">Critical only</option>
              <option value="high">High and above</option>
              <option value="medium">Medium and above</option>
              <option value="low">Everything</option>
            </select>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(setPagerStatus, async () => {
                    await update.mutateAsync({ pagerduty_routing_key: routingKey.trim() || null });
                    setRoutingDraft(null);
                    return routingKey.trim() ? "PagerDuty connected" : "PagerDuty removed";
                  })
                }
              >
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
              <Button
                variant="outline"
                disabled={busy || !settings?.pagerduty_routing_key || routingDraft !== null}
                onClick={() =>
                  run(setPagerStatus, async () => (await test.mutateAsync("pagerduty")).message)
                }
              >
                <TestTube className="mr-2 h-4 w-4" /> Test
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The test opens an info-level incident you can resolve.
          </p>
          <StatusLine status={pagerStatus} />
        </section>
      </div>
    </Card>
  );
}
