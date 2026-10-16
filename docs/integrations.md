---
created_at: 2026-10-16
updated_at: 2026-10-16
---

# Integrations

IDL Sentinel delivers alerts to chat tools, and gives automation three more ways in:
a signed webhook, PagerDuty, and a read-only JSON API. A GitHub Action built on the API
fails CI when a program you depend on changes.

## Public API

All endpoints are unauthenticated `GET` requests, allow any origin (CORS), and are
cached for up to 60 seconds. They return only data the program pages already show.

| Endpoint                             | Returns                                                |
| ------------------------------------ | ------------------------------------------------------ |
| `/api/v1/programs/{address}`         | Registry entry, latest IDL version, and on-chain state |
| `/api/v1/programs/{address}/idl`     | The latest captured IDL JSON and its normalized hash   |
| `/api/v1/programs/{address}/changes` | Changes for one program                                |
| `/api/v1/changes`                    | Changes across every registered program                |
| `/api/v1/changes/{id}`               | One change, including its before/after details         |

Change list parameters:

| Parameter      | Meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `since`        | ISO 8601 time; returns changes after it, oldest first                          |
| `cursor`       | The previous page's `next_cursor`; continues an oldest-first walk without gaps |
| `min_severity` | `low`, `medium`, `high`, or `critical`                                         |
| `category`     | `idl`, `code`, `authority`, `governance`, or `verification`                    |
| `limit`        | 1 to 200, default 50                                                           |

Without `since` or `cursor`, lists return the newest changes first. Poll a feed with
`since`, then follow `next_cursor` while `has_more` is true.

Program status example (abridged):

```json
{
  "program": { "address": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD", "name": "Kamino Lend" },
  "idl": { "hash": "…", "version": 3, "fetched_at": "2026-10-16T06:00:00Z" },
  "chain": {
    "loader": "upgradeable",
    "deploy_slot": 440486775,
    "code_hash": "b1344d19…229c22d9",
    "upgradeable": true,
    "authority_kind": "squads_v4",
    "multisig": {
      "threshold": 5,
      "members": 10,
      "time_lock_seconds": 86400,
      "pending_proposals": [
        {
          "index": 105,
          "status": "approved",
          "actions": ["upgrade"],
          "executable_at": "2026-10-15T16:34:22.000Z"
        }
      ]
    },
    "verification": { "status": "verified", "commit": "a08760976f51…" }
  }
}
```

`verification.status` is `verified`, `mismatch` (the deployed code differs from the
last verified build), or `unverified` (no verified build is published).

## Signed webhooks

Add an `https://` URL under Settings, Integrations. IDL Sentinel `POST`s one request
per program per alert batch:

```json
{
  "type": "changes.detected",
  "version": 1,
  "sent_at": "2026-10-16T06:48:05.000Z",
  "program": {
    "id": "…",
    "address": "KLend…",
    "name": "Kamino Lend",
    "url": "https://…/programs/…"
  },
  "changes": [
    {
      "id": "e8e8b81f-…",
      "type": "squads_proposal_approved",
      "category": "governance",
      "severity": "critical",
      "summary": "Squads proposal #105 to upgrade the program for 'Kamino Lend' reached 5/5 approvals; executable now",
      "detected_at": "2026-10-16T06:48:04.079668+00:00",
      "api_url": "https://…/api/v1/changes/e8e8b81f-…"
    }
  ]
}
```

The test button sends `"type": "test"` with an empty `changes` array.

Headers:

- `x-idl-sentinel-timestamp`: Unix seconds when the request was signed.
- `x-idl-sentinel-signature`: `v1=` followed by the hex HMAC-SHA256 of
  `"<timestamp>.<raw body>"`, keyed with your signing secret.

Verify before trusting the body, and reject old timestamps to stop replays:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, timestamp, rawBody, signature) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`
  );
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

The address IDL Sentinel connects to is checked by the socket's own DNS lookup, so
loopback, private, link-local, and reserved ranges (including `198.18.0.0/15` and the
IPv4-mapped IPv6 forms of all of these) are refused even under DNS rebinding. If you
self-host behind a "fake IP" DNS proxy that answers with reserved addresses, webhooks
will be refused until the server resolves real public addresses.

Answer with any 2xx status. Other statuses, timeouts (10 seconds), and redirects
count as failures and are retried with exponential backoff. Delivery is at least
once: deduplicate on `changes[].id`.

## PagerDuty

Create an Events API v2 integration on a PagerDuty service and paste its 32-character
routing key under Settings, Integrations. Choose the lowest severity that pages
(default `high`). Severities map to PagerDuty as critical → `critical`, high →
`error`, medium → `warning`, low → `info`. Each program batch triggers one event whose
`dedup_key` is derived from its change IDs, so a retried delivery does not open a
second incident.

## GitHub Action

Pin the programs you depend on, commit the pin file, and check it in CI.

```bash
node scripts/idl-sentinel-check.mjs pin \
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
  --api https://your-idl-sentinel.example
```

This writes `.idl-sentinel.json` with each program's IDL hash, deploy slot, code
hash, and pin time. Then add a workflow:

```yaml
name: Solana dependencies
on:
  pull_request:
  schedule:
    - cron: "0 * * * *"
jobs:
  idl-sentinel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: roborun-xyz/idl-sentinel@main
        with:
          fail-on: high # low | medium | high | critical
          # fail-on-pending: "true" # also fail while an approved upgrade waits to execute
```

The job fails when any change at or above `fail-on` was detected since the pin, and
warns when an approved Squads proposal is waiting to upgrade a pinned program. A job
summary lists every program. After reviewing, run `pin` again and commit the file.
The script has no dependencies and also runs locally with Node 18 or newer.
