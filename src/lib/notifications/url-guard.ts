import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

function isPrivateIPv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expands any valid IPv6 spelling (compressed, hex, or dotted tail) to 16 bytes. */
function ipv6Bytes(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0];
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(missing).fill("0"), ...tail].map((g) => parseInt(g, 16));
  if (groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups.flatMap((g) => [g >> 8, g & 0xff]);
}

/**
 * User-supplied webhook URLs are fetched from our servers, so they must not
 * reach loopback, link-local (cloud metadata), or private networks, in any
 * address spelling. Unparseable input counts as private.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version !== 6) return true;
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const zeroPrefix = (n: number) => bytes.slice(0, n).every((b) => b === 0);
  const embedded = () => bytes.slice(12).join(".");
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::a.b.c.d (NAT64).
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIPv4(embedded());
  if (zeroPrefix(12)) return true; // ::, ::1, and deprecated IPv4-compatible forms
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0)
  ) {
    return isPrivateIPv4(embedded());
  }
  // 64:ff9b:1::/48 is local-use NAT64; its translation targets are site-defined.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes[4] === 0 &&
    bytes[5] === 1
  ) {
    return true;
  }
  // 6to4 (2002::/16) carries an IPv4 address in bytes 2-5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isPrivateIPv4(bytes.slice(2, 6).join("."));
  // Teredo (2001:0::/32) carries the client IPv4 address, bit-inverted, in the last 4 bytes.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0) {
    return isPrivateIPv4(
      bytes
        .slice(12)
        .map((b) => b ^ 0xff)
        .join(".")
    );
  }
  return (
    (bytes[0] & 0xfe) === 0xfc || // fc00::/7 unique local
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || // fe80::/10 link-local
    bytes[0] === 0xff // multicast
  );
}

/** Returns an error message, or null when the URL is an acceptable public HTTPS endpoint. */
export function webhookUrlError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Webhook URL must be a valid URL";
  }
  if (url.protocol !== "https:") return "Webhook URL must use https://";
  if (url.username || url.password) return "Webhook URL must not contain credentials";
  if (raw.trim().length > 2048) return "Webhook URL is too long";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return "Webhook URL must be publicly reachable";
  }
  if (isIP(host) && isPrivateAddress(host)) return "Webhook URL must be publicly reachable";
  return null;
}

/** Resolves a hostname and reports whether every address is public (used when saving). */
export async function resolvesPublicly(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

/**
 * DNS lookup for the socket itself: the address checked is the address dialed,
 * so a rebinding answer between "check" and "connect" cannot reach a private host.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as unknown as Array<{ address: string; family: number }>;
    const blocked = list.find((entry) => isPrivateAddress(entry.address));
    if (!list.length || blocked) {
      return callback(
        Object.assign(new Error(`Refusing to connect to non-public address for ${hostname}`), {
          code: "EADDRNOTPUBLIC",
        }),
        "",
        0
      );
    }
    if (options.all) return callback(null, list as never);
    callback(null, list[0].address, list[0].family);
  });
};

/**
 * POSTs to a public HTTPS endpoint. Redirects are never followed, the response
 * body is discarded, and the whole exchange is bounded by `timeoutMs`.
 */
export function postToPublicHttps(
  url: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isPrivateAddress(host)) {
      reject(new Error("Refusing to connect to a non-public address"));
      return;
    }
    const req = request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        lookup: publicOnlyLookup,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
        res.on("error", reject);
      }
    );
    const deadline = setTimeout(
      () => req.destroy(new Error(`Webhook timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new Error(`Webhook timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(body);
  });
}
