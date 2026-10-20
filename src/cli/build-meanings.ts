/**
 * Builds resources/meanings.json.gz: one Punjabi meaning (arth) per corpus
 * line, from the Shabad OS database, aligned with resources/corpus.json.gz.
 *
 *   node dist/cli/build-meanings.js [master.sqlite] [corpus.json.gz] [out.json.gz]
 *
 * One teeka per scripture, in this order of preference:
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';

export const MEANING_SOURCES: { id: string; name: string }[] = [
  { id: 'PSST', name: 'Prof. Sahib Singh, Sri Guru Granth Darpan' },
  { id: 'RSJD', name: 'Dr. Ratan Singh Jaggi, Sri Dasam Granth' },
  { id: 'VBGS', name: 'Bhai Vir Singh, Varan Bhai Gurdas Steek' },
  { id: 'SSSK', name: 'Sampuran Singh, Kabit Sawayan Bhai Gurdas Ji Steek' },
  { id: 'GSNL', name: 'Ganda Singh, Bhai Nand Lal Granthavali' },
  { id: 'SBMS', name: 'Manmohan Singh, Sri Guru Granth Sahib (SGPC)' },
  { id: 'NKFT', name: 'Faridkot Wala Teeka' },
];

export interface MeaningsFile {
  version: 1;
  provenance: string;
  sources: { id: string; name: string }[];
  /** Punjabi meaning per corpus line ('' when none). */
  pa: string[];
  /** Index into `sources` per line (-1 when none). */
  paSource: number[];
}

function main(): void {
  const dbPath = resolve(process.argv[2] ?? 'assets/shabados/master.sqlite');
  const corpusPath = resolve(process.argv[3] ?? 'resources/corpus.json.gz');
  const outPath = resolve(process.argv[4] ?? 'resources/meanings.json.gz');
  const corpus = JSON.parse(gunzipSync(readFileSync(corpusPath)).toString('utf8')) as { lines: { id: string[] } };
  const db = new DatabaseSync(dbPath, { readOnly: true });

  // GSNL's display name comes from the database when present.
  const assetName = db.prepare('SELECT name FROM assets WHERE id = ?');
  const sources = MEANING_SOURCES.map((s) => {
    const row = assetName.get(s.id) as { name: string } | undefined;
    if (!row) throw new Error(`asset ${s.id} not in database`);
    return s;
  });
  const rank = new Map(sources.map((s, i) => [s.id, i]));

  const best = new Map<string, { rank: number; text: string }>();
  const rows = db
    .prepare(
      `SELECT line_id, asset_id, data FROM asset_lines
        WHERE type = 'translation' AND json_extract(additional, '$.language') = 'pa'`,
    )
    .all() as { line_id: string; asset_id: string; data: string }[];
  for (const r of rows) {
    const k = rank.get(r.asset_id);
    if (k === undefined || !r.data.trim()) continue;
    const cur = best.get(r.line_id);
    if (!cur || k < cur.rank) best.set(r.line_id, { rank: k, text: r.data.trim().replace(/\s+/g, ' ') });
  }

  const ids = corpus.lines.id;
  const file: MeaningsFile = {
    version: 1,
    provenance: 'Shabad OS Database 5.0.0-next.0 (translations cited in its README)',
    sources,
    pa: ids.map((id) => best.get(id)?.text ?? ''),
    paSource: ids.map((id) => best.get(id)?.rank ?? -1),
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(file)), { level: 9 });
  writeFileSync(outPath, gz);
  const counts = sources.map((s, i) => `${s.id} ${file.paSource.filter((x) => x === i).length}`);
  const missing = file.paSource.filter((x) => x < 0).length;
  console.log(`wrote ${outPath}: ${(gz.length / 1e6).toFixed(1)} MB; ${counts.join(', ')}; no meaning: ${missing} of ${ids.length}`);
}

if (require.main === module) main();
