type FetchInitWithTimeout = RequestInit & {
  timeoutMs?: number;
  maxBytes?: number;
};

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: FetchInitWithTimeout = {}
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    maxBytes = 16 * 1024 * 1024,
    signal,
    ...fetchInit
  } = init;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  try {
    const response = await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw new Error("Response exceeds maximum allowed size");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Fetch timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
