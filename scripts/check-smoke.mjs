// Checks the report written by an installed app's smoke run (GURBANI_SMOKE_REPORT):
// after 45 s of the Japji fixture in paath mode, the app must show a Japji line
// from Sri Guru Granth Sahib, and both screenshots must exist.
//   node scripts/check-smoke.mjs <report.json> <operator.png> <projector.png>
import { existsSync, readFileSync, statSync } from 'node:fs';

const [report, ...shots] = process.argv.slice(2);
const fail = (msg) => {
  console.error(`smoke check failed: ${msg}`);
  process.exit(1);
};
if (!report || !existsSync(report)) fail(`no report at ${report} (the app did not finish its smoke run)`);
const { view } = JSON.parse(readFileSync(report, 'utf8'));
if (!view.current) fail('no line on screen');
if (!view.source.startsWith('Sri Guru Granth Sahib · Jap')) fail(`unexpected source "${view.source}"`);
// Japji Sahib is the first ~400 lines of the corpus; 45 s in is within the first pauri or two.
if (view.current.line < 1 || view.current.line > 40) fail(`unexpected line ${view.current.line}: ${view.current.text}`);
for (const s of shots) {
  if (!existsSync(s) || statSync(s).size < 10_000) fail(`missing or empty screenshot ${s}`);
}
console.log(`smoke check ok: line ${view.current.line} "${view.current.text}" (${view.source})`);
