import { normalizeWishlistSlugs } from "./wishlist";

const SYNC_ERROR = "Unable to sync your wishlist. Please try again.";

/** A dev-server restart or proxy error can return HTML before the API runs. */
export async function requestWishlist(
  method: "GET" | "POST" | "DELETE",
  userId: string,
  signal: AbortSignal,
  body?: object,
): Promise<{ slugs: string[]; unmergedSlugs: string[] }> {
  // Reads can recover from a transient non-JSON response. Never replay writes.
  const attempts = method === "GET" ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal.throwIfAborted();
    const response = await fetch("/api/wishlist", {
      method,
      cache: "no-store",
      credentials: "same-origin",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-wishlist-user": userId,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    let data: unknown = null;
    if (contentType === "application/json") {
      try {
        data = await response.json();
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof SyntaxError)) throw error;
      }
    } else {
      await response.body?.cancel();
    }
    signal.throwIfAborted();

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      if (attempt + 1 < attempts) continue;
      throw new Error(SYNC_ERROR);
    }
    const result = data as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof result.error === "string" && result.error.trim()
          ? result.error
          : SYNC_ERROR,
      );
    }
    if (result.userId !== userId) {
      throw new Error("Your account changed. Please reload your wishlist.");
    }
    if (!Array.isArray(result.slugs)) throw new Error(SYNC_ERROR);
    return {
      slugs: normalizeWishlistSlugs(result.slugs),
      unmergedSlugs: normalizeWishlistSlugs(result.unmergedSlugs),
    };
  }
  throw new Error(SYNC_ERROR);
}
