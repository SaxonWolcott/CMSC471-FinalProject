// Sequential single-hue blue palette for Scene 1's owner-bucket tiers.
// Darkest (Drowned) sits at the bottom of each bar; lightest (Phenomenon) at
// the top. The "flood" metaphor is intentional — drowned games are submerged
// in deep water; the rare hits surface into pale daylight.
//
// Range chosen for clear contrast at both ends without going pure white
// (which would disappear against the page background).

export const TIERS = ["drowned", "niche", "modest", "hit", "phenomenon"];

export const TIER_COLORS = {
  drowned: "#08306b",
  niche: "#2171b5",
  modest: "#4292c6",
  hit: "#9ecae1",
  phenomenon: "#deebf7",
};

export const TIER_LABELS = {
  drowned: "Drowned",
  niche: "Niche",
  modest: "Modest",
  hit: "Hit",
  phenomenon: "Phenomenon",
};

export const TIER_DEFINITIONS = {
  drowned: "≤ 20k owners (smallest SteamSpy bucket)",
  niche: "20k – 100k owners",
  modest: "100k – 1M owners",
  hit: "1M – 10M owners",
  phenomenon: "10M+ owners",
};
