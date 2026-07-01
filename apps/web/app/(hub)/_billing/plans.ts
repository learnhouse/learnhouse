// Canonical plan / pack catalog for the .io hub (single source of truth).
//
// This is the ONE static catalog shared by the billing hub (app/(hub)/billing)
// and the create-org onboarding (app/(hub)/new). Previously these lived in two
// divergent copies (billing/_lib/plans.ts and new/plans.ts) whose prices had
// drifted apart (e.g. personal 9 vs 15, pro 79 vs 149). Both of those modules
// now re-export from here so displayed prices are identical everywhere; Stripe
// still charges by plan id.
//
// The platform repo imports ALL_PLANS / PERSONAL_PLANS / PricingCards from
// @components/Landing/*, none of which exist in apps/web. This module rebuilds
// the minimal catalog the UI needs: the plan hierarchy
// (free → personal → personal-family → standard → pro → enterprise), their
// display/badge styling, static fallback prices, and the add-on packs.
//
// Live prices/limits come from GET /api/billing/prices and are layered on top
// of these static values via `applyPlanLimits` / the PriceOverrides props — the
// static catalog is only the fallback when Stripe prices are unavailable.

export type Billing = "monthly" | "annual";
export type PlanId =
  | "free"
  | "personal"
  | "personal-family"
  | "standard"
  | "pro"
  | "enterprise";
export type PackId = "ai_500" | "seats_200";

// Annual discounts used only as a fallback when live Stripe prices aren't loaded.
export const ANNUAL_DISCOUNT = 0.2;
export const PERSONAL_ANNUAL_DISCOUNT = 1 / 12;

export type LimitKey = "courses" | "members" | "admin_seats";

export interface PlanFeature {
  label: string;
  badge?: string;
  /** Look up a numeric limit in PlanLimits to produce a dynamic label. */
  limitKey?: LimitKey;
  /** Look up ai_credits in PlanLimits to produce a dynamic badge. */
  badgeLimitKey?: "ai_credits";
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyPrice: number;
  /** Personal-tier plan (different annual discount + tab grouping). */
  personal?: boolean;
  popular?: boolean;
  badge: string;
  ctaStyle: string;
  topGlow: string;
  patternColor: string;
  accentColor: string;
  inheritsFrom?: string;
  inheritsBadge?: string;
  features: PlanFeature[];
}

// Live price/limit shapes returned by GET /api/billing/prices.
export interface PriceOverrides {
  [planId: string]: {
    monthly: number;
    annualPerMonth: number;
    annualTotal: number;
    currency: string;
  };
}
export interface PackPrices {
  [packId: string]: { price: number; currency: string };
}
export interface PlanLimits {
  [planId: string]: {
    courses: number;
    members: number;
    admin_seats: number;
    ai_credits: number;
    storage: number;
  };
}

export interface PricesResponse {
  plans?: PriceOverrides;
  packs?: PackPrices;
  limits?: PlanLimits;
}

const BADGE = {
  free: "bg-gradient-to-br from-gray-100 to-gray-200 text-gray-700 border-gray-200 shadow-sm shadow-gray-200/50",
  standard:
    "bg-gradient-to-br from-blue-100 to-blue-200 text-blue-800 border-blue-200 shadow-sm shadow-blue-200/50",
  pro: "bg-gradient-to-br from-purple-100 to-purple-200 text-purple-800 border-purple-200 shadow-sm shadow-purple-200/50",
  personal:
    "bg-gradient-to-br from-amber-100 to-yellow-200 text-amber-800 border-amber-200 shadow-sm shadow-amber-200/50",
  enterprise:
    "bg-gradient-to-br from-amber-100 to-amber-200 text-amber-800 border-amber-300/60 shadow-sm shadow-amber-200/50",
};

export const GENERAL_PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Explore the basics, no commitment.",
    monthlyPrice: 0,
    badge: BADGE.free,
    ctaStyle: "bg-neutral-900 text-white hover:bg-neutral-800",
    topGlow: "rgba(156,163,175,0.06)",
    patternColor: "rgba(156,163,175,0.08)",
    accentColor: "text-gray-600",
    features: [
      { label: "1 Course", limitKey: "courses" },
      { label: "10 Members", limitKey: "members" },
      { label: "Watermark" },
    ],
  },
  {
    id: "standard",
    name: "Standard",
    tagline: "Payments, AI, analytics, and more.",
    monthlyPrice: 49,
    badge: BADGE.standard,
    ctaStyle: "bg-blue-600 text-white hover:bg-blue-700",
    topGlow: "rgba(59,130,246,0.05)",
    patternColor: "rgba(59,130,246,0.06)",
    accentColor: "text-blue-600",
    inheritsFrom: "Free",
    inheritsBadge: BADGE.free,
    features: [
      { label: "500 Members", badge: "+200 for $50/mo", limitKey: "members" },
      { label: "2 Admin seats", limitKey: "admin_seats" },
      { label: "Standard AI", badge: "1,000 Credits", badgeLimitKey: "ai_credits" },
      { label: "Unlimited Courses" },
      { label: "No Watermark" },
      { label: "Payments", badge: "0% fees" },
      { label: "Code" },
      { label: "Communities" },
      { label: "Podcasts" },
      { label: "Analytics" },
      { label: "SEO" },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Custom domains, certifications, and full control.",
    monthlyPrice: 149,
    popular: true,
    badge: BADGE.pro,
    ctaStyle: "bg-purple-600 text-white hover:bg-purple-700",
    topGlow: "rgba(147,51,234,0.05)",
    patternColor: "rgba(147,51,234,0.06)",
    accentColor: "text-purple-600",
    inheritsFrom: "Standard",
    inheritsBadge: BADGE.standard,
    features: [
      { label: "1,000 Members", badge: "+200 for $50/mo", limitKey: "members" },
      { label: "10 Admin seats", limitKey: "admin_seats" },
      { label: "Advanced AI", badge: "3,000 Credits", badgeLimitKey: "ai_credits" },
      { label: "Certifications" },
      { label: "Playgrounds" },
      { label: "Boards" },
      { label: "Custom Domains" },
      { label: "Versioning" },
      { label: "Advanced Analytics" },
      { label: "Priority Support" },
      { label: "API Access" },
    ],
  },
];

export const PERSONAL_PLANS: Plan[] = [
  {
    id: "personal",
    name: "Personal",
    tagline: "Everything you need to learn smarter.",
    monthlyPrice: 15,
    personal: true,
    badge: BADGE.personal,
    ctaStyle: "bg-amber-500 text-white hover:bg-amber-600",
    topGlow: "rgba(245,158,11,0.05)",
    patternColor: "rgba(245,158,11,0.06)",
    accentColor: "text-amber-600",
    features: [
      { label: "Unlimited Courses" },
      { label: "1 Member", limitKey: "members" },
      { label: "Standard AI", badge: "500 Credits", badgeLimitKey: "ai_credits" },
      { label: "Boards" },
      { label: "Playgrounds" },
    ],
  },
  {
    id: "personal-family",
    name: "Family",
    tagline: "Learn together with your family.",
    monthlyPrice: 41,
    personal: true,
    popular: true,
    badge: BADGE.personal,
    ctaStyle: "bg-amber-500 text-white hover:bg-amber-600",
    topGlow: "rgba(245,158,11,0.05)",
    patternColor: "rgba(245,158,11,0.06)",
    accentColor: "text-amber-600",
    inheritsFrom: "Personal",
    inheritsBadge: BADGE.personal,
    features: [
      { label: "4 Members", limitKey: "members" },
      { label: "Advanced AI", badge: "3,000 Credits", badgeLimitKey: "ai_credits" },
    ],
  },
];

export const ENTERPRISE_PLAN: Plan = {
  id: "enterprise",
  name: "Enterprise",
  tagline:
    "Custom pricing for large organizations with advanced security, compliance, and support needs.",
  monthlyPrice: 0,
  badge: BADGE.enterprise,
  ctaStyle: "bg-neutral-900 text-white hover:bg-neutral-800",
  topGlow: "rgba(245,158,11,0.05)",
  patternColor: "rgba(245,158,11,0.06)",
  accentColor: "text-amber-600",
  inheritsFrom: "Pro",
  inheritsBadge: BADGE.pro,
  features: [
    { label: "Audit Logs" },
    { label: "SSO / OIDC" },
    { label: "SCORM" },
    { label: "RBAC" },
    { label: "Multi Tenancy" },
    { label: "White-label" },
    { label: "Support SLA" },
    { label: "Self-hosted option" },
  ],
};

export const ALL_PLANS: Plan[] = [
  ...GENERAL_PLANS,
  ...PERSONAL_PLANS,
  ENTERPRISE_PLAN,
];

export function findPlan(planId: string): Plan | undefined {
  return ALL_PLANS.find((p) => p.id === planId);
}

export function isPersonalPlan(planId: string): boolean {
  return PERSONAL_PLANS.some((p) => p.id === planId);
}

const LIMIT_LABELS: Record<LimitKey, [string, string]> = {
  courses: ["Course", "Courses"],
  members: ["Member", "Members"],
  admin_seats: ["Admin seat", "Admin seats"],
};

/** Override a plan's hardcoded feature labels/badges with live backend limits. */
export function applyPlanLimits(plan: Plan, limits?: PlanLimits): Plan {
  const entry = limits?.[plan.id];
  if (!entry) return plan;
  return {
    ...plan,
    features: plan.features.map((f) => {
      const patched = { ...f };
      if (f.limitKey && entry[f.limitKey] !== undefined) {
        const n = entry[f.limitKey];
        const [singular, plural] = LIMIT_LABELS[f.limitKey];
        patched.label =
          n === 0
            ? `Unlimited ${plural}`
            : `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
      }
      if (f.badgeLimitKey === "ai_credits" && entry.ai_credits !== undefined) {
        const n = entry.ai_credits;
        if (n > 0) patched.badge = `${n.toLocaleString()} Credits`;
      }
      return patched;
    }),
  };
}

export function getCurrencySymbol(
  planId: string,
  overrides?: PriceOverrides,
): string {
  const c =
    overrides?.[planId]?.currency ?? Object.values(overrides ?? {})[0]?.currency;
  return c === "eur" ? "€" : "$";
}

/** Resolve the displayed per-month price for a plan/billing, live price first. */
export function calcPrice(
  monthlyPrice: number,
  billing: Billing,
  planId: string,
  overrides?: PriceOverrides,
): number {
  if (monthlyPrice === 0) return 0;
  const override = overrides?.[planId];
  if (override) {
    if (billing === "annual" && override.annualPerMonth > 0) {
      return Math.round(override.annualPerMonth);
    }
    if (billing === "monthly" && override.monthly > 0) {
      return Math.round(override.monthly);
    }
  }
  const discount = isPersonalPlan(planId)
    ? PERSONAL_ANNUAL_DISCOUNT
    : ANNUAL_DISCOUNT;
  return billing === "annual"
    ? Math.round(monthlyPrice * (1 - discount))
    : monthlyPrice;
}

/**
 * Convenience helpers consumed by the onboarding (app/(hub)/new). The billing
 * hub uses calcPrice/getCurrencySymbol directly; onboarding renders a single
 * price string and a paid/free distinction, so these wrap that logic.
 */
export function isPaidPlan(id: PlanId | string | null | undefined): boolean {
  return !!id && id !== "free";
}

/** Format a resolved price for display. null → "Custom", 0 → "Free". */
export function formatPrice(
  value: number | null | undefined,
  symbol = "$",
): string {
  if (value == null) return "Custom";
  if (value === 0) return "Free";
  return `${symbol}${value}`;
}

// ── Add-on packs ──────────────────────────────────────────────────────────────

export interface PackCatalogEntry {
  id: PackId;
  type: "ai_credits" | "member_seats";
  quantity: number;
  label: string;
  fallbackPrice: number;
}

export const PACK_CATALOG: PackCatalogEntry[] = [
  { id: "ai_500", type: "ai_credits", quantity: 500, label: "500 AI Credits", fallbackPrice: 5 },
  { id: "seats_200", type: "member_seats", quantity: 200, label: "200 Member Seats", fallbackPrice: 50 },
];

export function getPackPrice(packId: string, packPrices?: PackPrices): number {
  const stripePrice = packPrices?.[packId];
  if (stripePrice) return stripePrice.price;
  return PACK_CATALOG.find((p) => p.id === packId)?.fallbackPrice ?? 0;
}

export function getPackCurrencySymbol(
  packId: string,
  packPrices?: PackPrices,
  planOverrides?: PriceOverrides,
): string {
  const c =
    packPrices?.[packId]?.currency ??
    Object.values(packPrices ?? {})[0]?.currency ??
    Object.values(planOverrides ?? {})[0]?.currency;
  return c === "eur" ? "€" : "$";
}
