// Steam-themed tier palette for Scene 1's owner-bucket tiers.
//
// The chart sits on a dark navy background, so the previous "darkest = drowned"
// scheme would have made the dominant tier invisible. Instead: Drowned is the
// brightest Steam-cyan (since it grows to fill 95% of bars, it should be the
// visual focus), middle tiers fade through deeper blues, and the rare
// Phenomenon tier resurfaces as near-white — a bright sliver that stands out
// at the top of each bar.

export const TIERS = ["drowned", "niche", "modest", "hit", "phenomenon"];

export const TIER_COLORS = {
  drowned: "#67c1f5",       // Steam iconic cyan, brightest
  niche: "#4a93c4",
  modest: "#2e6991",
  hit: "#1f4866",
  phenomenon: "#e6edf2",    // near-white, rare hits visible at top
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
