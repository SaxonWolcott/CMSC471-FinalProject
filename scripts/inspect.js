// Debug script — confirms the games.csv header bug (39-col header vs 40-col data rows).
// See plan.md "CSV header bug". Kept for reference; not part of the build.
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '..', 'raw_data', 'games.csv');

const fd = await open(CSV_PATH);
const buf = Buffer.alloc(120_000);
await fd.read(buf, 0, 120_000, 0);
await fd.close();
const text = buf.toString('utf8');

function parseRows(s, max) {
  const rows = []; let row = []; let cur = ''; let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') {
        row.push(cur); rows.push(row); row = []; cur = '';
        if (rows.length >= max) return rows;
      } else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  return rows;
}

const rows = parseRows(text, 6);
const header = rows[0];

console.log('Header column count:', header.length);
console.log('Data row column counts:', rows.slice(1).map(r => r.length));
console.log('');
console.log('Header (positions 5-15):');
for (let i = 5; i < 16; i++) console.log(`  [${i}] ${header[i]}`);
console.log('');

for (let r = 1; r < rows.length; r++) {
  console.log(`--- Row ${r}: ${rows[r][1]} (AppID ${rows[r][0]}) ---`);
  for (let idx = 5; idx < 15; idx++) {
    const v = rows[r][idx] ?? '';
    const preview = v.length > 100 ? v.slice(0, 100) + '...' : v;
    console.log(`  data[${idx}] (header says "${header[idx]}"): ${JSON.stringify(preview)}`);
  }
  console.log('');
}
