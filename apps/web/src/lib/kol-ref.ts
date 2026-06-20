/** Slug shape shared by KOL ref capture + server-side attribution. */
export const KOL_SLUG_RE = /^[a-z0-9-]+$/

/**
 * Resolve which KOL slug to attribute from the current location.
 *
 * An explicit `?ref=<slug>` (works on any page) takes priority; otherwise the
 * `/k/<slug>` landing path is used, so a KOL's pretty landing link attributes
 * the sale exactly like the ?ref link does — previously the landing page set no
 * cookie at all, so /k/<slug> visitors were never credited to the KOL.
 *
 * Returns a validated slug, or null when there's nothing valid to capture.
 */
export function resolveKolRef(
  pathname: string,
  refParam: string | null,
): string | null {
  const fromPath = pathname.match(/^\/k\/([a-z0-9-]+)\/?$/)?.[1] ?? null
  const ref = (refParam ?? fromPath ?? "").trim()
  return KOL_SLUG_RE.test(ref) ? ref : null
}
