/**
 * Lead source categories.
 *
 * ArboStar records 58 distinct intake sources, many of which are the same
 * channel spelled differently. This maps each raw source onto the channel
 * language TreeNewal already uses, so Wes can read demand by channel rather
 * than by data entry habit.
 *
 * Rules are matched in order, first match wins. Anything unmatched falls
 * through to "Other", which keeps new ArboStar sources visible rather than
 * silently folded into a bucket.
 *
 * Proposed to Chris on 2026-08-24 and applied with his corrections.
 *
 * Local Services Ads are part of Paid Ads on the spend side, per Chris, so
 * every cost figure that comes from the leads sheet already includes them.
 * ArboStar has no Local Services label at intake, so LSA calls land under
 * Direct or SEO and this mapping understates Paid Ads leads. That is a data
 * entry gap, not a mapping choice, and it is footnoted on the Marketing
 * screen. Fixing it properly means adding an LSA source in ArboStar intake.
 */

export type Category =
  | "Repeat and referral"
  | "Direct"
  | "SEO"
  | "Paid Ads"
  | "Reputation and listings"
  | "Offline and local"
  | "Not recorded"
  | "Other";

export const CATEGORY_ORDER: Category[] = [
  "Paid Ads",
  "SEO",
  "Reputation and listings",
  "Offline and local",
  "Direct",
  "Repeat and referral",
  "Other",
  "Not recorded",
];

/** Channels TreeNewal buys. Everything else is demand it already earned. */
export const PAID_CATEGORIES: Category[] = ["Paid Ads"];

type Rule = { match: RegExp; category: Category };

const RULES: Rule[] = [
  // Not recorded, including intake form placeholders left untouched.
  {
    match: /^(not recorded|no info provided|not selected|choose one|n\/a|unknown)$/i,
    category: "Not recorded",
  },

  // Paid. Google CPC is the only source clearly labelled as bought media.
  { match: /google cpc|adwords|google ads|\bppc\b|paid search|\blsa\b|local services/i, category: "Paid Ads" },

  // Earned search, including the Google Business Profile listings per city.
  {
    match: /\bgmb\b|google (organic|local|my business|business)|bing|yahoo|duckduckgo|organic|blog|youtube|ai chats?|chatgpt|\bseo\b/i,
    category: "SEO",
  },

  // Reviews, directories and social listings.
  { match: /birdeye|\bbbb\b|nextdoor|facebook|instagram|yelp|angi|home ?advisor|thumbtack/i, category: "Reputation and listings" },

  // Work the company already earned: past clients, referrals, staff.
  {
    match: /repeat|returning|^client$|referral|friend|neighbou?r|\bwom\b|word of mouth|employee/i,
    category: "Repeat and referral",
  },

  // Someone called, emailed or filled in the form with no channel attached.
  { match: /main number|treenewal\.com|^form$|phone|walk ?in|email/i, category: "Direct" },

  // Print, vehicles, events and community groups.
  {
    match: /brochure|door ?hanger|vehicle|logo|sign|press release|garden club|extension|ranch|show|event|mailer|postcard/i,
    category: "Offline and local",
  },
];

export function categorize(source: string | undefined): Category {
  const name = (source ?? "").trim();
  if (name === "") return "Not recorded";
  for (const rule of RULES) {
    if (rule.match.test(name)) return rule.category;
  }
  return "Other";
}

export function isPaidCategory(category: Category): boolean {
  return PAID_CATEGORIES.includes(category);
}
