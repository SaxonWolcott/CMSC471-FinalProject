// Cool-to-warm tier palette for Scene 1's owner-bucket tiers.
//
// The chart sits on a dark navy background, where any all-blue palette
// produced muddy mid-tiers and competed with Steam's cyan accent. A
// cool-to-warm gradient solves both: the dominant Drowned tier sits as a
// muted cool blue (visible-but-quiet, since it grows to fill 95% of bars and
// would be visually overwhelming if saturated), the middle tiers progress
// to a transitional light blue, and the rare Hit / Phenomenon tiers emerge
// in warm amber and gold so they read as "the bright exceptions" against
// the cool field beneath them.

export const TIERS = ["drowned", "niche", "modest", "hit", "phenomenon"];

export const TIER_COLORS = {
  drowned: "#3a5570",       // dim cool blue — recedes into the field
  niche: "#5b85a8",         // medium cool blue
  modest: "#bcd5e6",        // pale cool blue — transitional
  hit: "#f0a93f",           // warm amber — visible breakthrough
  phenomenon: "#ffd966",    // golden cream — rare highlight
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
