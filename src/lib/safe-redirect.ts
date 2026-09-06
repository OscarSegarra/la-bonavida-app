/**
 * Only ever accept a `next` redirect target that is a same-origin,
 * server-relative path - never a client-supplied absolute URL or
 * protocol-relative one (open-redirect vectors: `next=https://evil.com`,
 * `next=//evil.com`, `next=/\evil.com`). Falls back to a known-safe path
 * for anything else.
 */
export function safeRedirectPath(
  next: string | null | undefined,
  fallback: string,
): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/\\") &&
    !next.includes("://")
  ) {
    return next;
  }
  return fallback;
}
