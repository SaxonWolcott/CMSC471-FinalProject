// Debug script — confirms that Genres / Tags / Categories are comma-delimited
// (not semicolon as the original plan guessed). Kept for reference; not part of the build.
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "raw_data", "games.csv");

const fd = await open(CSV_PATH);
const buf = Buffer.alloc(2_000_000);
await fd.read(buf, 0, 2_000_000, 0);
await fd.close();
const text = buf.toString("utf8");

const allRows = d3.csvParseRows(text);
console.log(`Loaded ${allRows.length} rows from buffer`);

// Position 36 is Genres, 37 is Tags in the canonical schema
console.log("\nSample Genres (col 36) and Tags (col 37) for first 5 data rows:");
for (let i = 1; i <= 5 && i < allRows.length; i++) {
  console.log(`\n--- Row ${i}: ${allRows[i][1]} ---`);
  console.log("  Genres (raw):", JSON.stringify(allRows[i][36]));
  console.log("  Tags (raw):  ", JSON.stringify(allRows[i][37]));
}

// Find a row where Tags actually contains "Indie" anywhere (so we can see real structure)
console.log("\n--- First 3 rows where Tags string contains 'Indie' ---");
let found = 0;
for (let i = 1; i < allRows.length && found < 3; i++) {
  const tags = allRows[i][37] || "";
  if (tags.includes("Indie")) {
    console.log(`\n  Row ${i}: ${allRows[i][1]}`);
    console.log("  Genres (raw):", JSON.stringify(allRows[i][36]));
    console.log("  Tags (raw):  ", JSON.stringify(tags));
    found++;
  }
}
