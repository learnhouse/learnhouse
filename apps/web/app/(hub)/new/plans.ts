// The onboarding plan catalog was merged into the shared hub catalog so /new and
// /billing render identical prices (the old static copy here had drifted: it
// showed personal 9 / family 19 / standard 29 / pro 79 instead of the canonical
// 15 / 41 / 49 / 149). new/page.tsx now imports directly from the canonical
// module; this re-export is kept for any remaining `./plans` importers.
//
// Canonical source: app/(hub)/_billing/plans.ts
export * from "../_billing/plans";
