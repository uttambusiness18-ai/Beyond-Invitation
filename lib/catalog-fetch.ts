import "server-only";

const ATTEMPT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 250;
const TRANSIENT_STATUSES = new Set([408, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

function unavailableResponse(status: number, code = `CATALOGUE_HTTP_${status}`) {
  return Response.json({
    code,
    message: `The product catalogue is temporarily unavailable (HTTP ${status}). Please try again shortly.`,
    details: null,
    hint: null,
  }, { status });
}

/** Public catalogue reads only. Admin writes use a separate Supabase client. */
export async function catalogueFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const readOnly = url.pathname.startsWith("/rest/v1/") && (
    method === "GET" || method === "HEAD" ||
    (method === "POST" && url.pathname === "/rest/v1/rpc/storefront_product_page")
  );
  if (!readOnly) return fetch(input, init);
  const callerSignal = init?.signal ?? request?.signal;

  // Two attempts total; SDK retries are disabled on this client to avoid multiplying them.
  for (let attempt = 0; attempt < 2; attempt++) {
    callerSignal?.throwIfAborted();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(request ? request.clone() : input, {
        ...init,
        signal: controller.signal,
        ...(attempt === 0
          ? { next: { ...init?.next, revalidate: 60, tags: ["catalogue"] } }
          : { cache: "no-store", next: { revalidate: 0 } }),
      });
      if (attempt === 0 && TRANSIENT_STATUSES.has(response.status)) {
        await response.body?.cancel();
      } else {
        // Read under the same deadline, including a stalled response body.
        const body = await response.text();
        if (!response.ok && method !== "HEAD") {
          try {
            const error = JSON.parse(body);
            if (!error || typeof error.message !== "string" || /<!doctype|<html\b/i.test(error.message)) {
              return unavailableResponse(response.status);
            }
          } catch {
            return unavailableResponse(response.status);
          }
        }
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(method === "HEAD" || [204, 205, 304].includes(response.status) ? null : body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    } catch {
      // A user/request cancellation must not become a retry or a service error.
      callerSignal?.throwIfAborted();
      if (attempt === 1) {
        return unavailableResponse(controller.signal.aborted ? 504 : 503,
          controller.signal.aborted ? "CATALOGUE_TIMEOUT" : "CATALOGUE_NETWORK");
      }
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  // The final attempt either returns a response or propagates caller cancellation.
  return unavailableResponse(503);
}
