/**
 * Only ever accept a `next` redirect target that is a same-origin,
 * server-relative path - never a client-supplied absolute URL or
 * protocol-relative one (open-redirect vectors: `next=https://evil.com`,
 * `next=//evil.com`, `next=/\evil.com`). Falls back to a known-safe path
 * for anything else.
 * @param next The candidate redirect target, typically from a form field
 * or query param - untrusted, may be null/undefined/malicious.
 * @param fallback The path to use if `next` fails validation.
 * @returns `next` if it's a safe relative path, otherwise `fallback`.
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
