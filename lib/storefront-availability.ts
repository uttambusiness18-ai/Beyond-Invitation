/** Temporarily paused collections retain their products, routes and assets. */
export const SHAGUN_ENVELOPES_ENABLED = true;

export const HIDDEN_STOREFRONT_SUBJECTS = SHAGUN_ENVELOPES_ENABLED
  ? []
  : [
      "shagun envelopes",
      "sagun envelopes",
      "shagun envelope",
      "sagun envelope",
    ];

export function isStorefrontSubjectVisible(subject?: string | null): boolean {
  return !HIDDEN_STOREFRONT_SUBJECTS.includes(
    (subject ?? "").trim().toLowerCase(),
  );
}

export function isStorefrontCollectionVisible(slug: string): boolean {
  return slug !== "shagun-envelopes" || SHAGUN_ENVELOPES_ENABLED;
}
