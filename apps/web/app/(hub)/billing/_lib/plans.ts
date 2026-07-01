// The plan / pack catalog now lives in the shared hub module so the billing UI
// and the create-org onboarding render the SAME prices. This file is kept only
// as a re-export so the billing components (and billingClient.ts) can continue
// importing from `../_lib/plans` unchanged.
//
// Canonical source: app/(hub)/_billing/plans.ts
export * from "../../_billing/plans";
