/**
 * Tiny UUIDv4 helper. We avoid pulling in a dependency for this since
 * `crypto.randomUUID` is available in every modern browser the PWA targets.
 */
export function uuid(): string {
  return crypto.randomUUID();
}
