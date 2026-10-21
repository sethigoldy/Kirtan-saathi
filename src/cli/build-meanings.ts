/**
 * Builds resources/meanings.json.gz: one Punjabi meaning (arth) and one
 * English translation per corpus line, from the Shabad OS database, aligned
 * with resources/corpus.json.gz.
 *
 *   node dist/cli/build-meanings.js [master.sqlite] [corpus.json.gz] [out.json.gz]
 *
 * One teeka / translation per scripture, in this order of preference:
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

export const ENGLISH_SOURCES: { id: string; name: string }[] = [
  { id: 'DSSK', name: 'Dr. Sant Singh Khalsa, Siri Guru Granth Sahib' },
  { id: 'DSKO', name: 'Dr. Surinder Singh Kohli, Sri Dasam Granth Sahib' },
  { id: 'JVBG', name: 'Jodh Singh, Varan Bhai Gurdas' },
  { id: 'SSPK', name: 'Shamsher Singh Puri, Kabitt Swayye Bhai Gurdas Ji' },
  { id: 'KEGP', name: 'Pritpal Singh Bindra, Kalaam-e-Goya (Bhai Nand Lal)' },
  { id: 'SBMS', name: 'Manmohan Singh, Sri Guru Granth Sahib (SGPC)' },
];

export interface MeaningsFile {
  version: 2;
  provenance: string;
  sources: { id: string; name: string }[];
  /** Punjabi meaning per corpus line ('' when none). */
  pa: string[];
  /** Index into `sources` per line (-1 when none). */
  paSource: number[];
  enSources: { id: string; name: string }[];
  /** English translation per corpus line ('' when none). */
  en: string[];
  /** Index into `enSources` per line (-1 when none). */
  enSource: number[];
}

/** The preferred translation in `language` per corpus line id. */
function pick(db: DatabaseSync, language: string, sources: { id: string }[]): Map<string, { rank: number; text: string }> {
  const assetName = db.prepare('SELECT name FROM assets WHERE id = ?');
  for (const s of sources) if (!assetName.get(s.id)) throw new Error(`asset ${s.id} not in database`);
  const rank = new Map(sources.map((s, i) => [s.id, i]));
  const best = new Map<string, { rank: number; text: string }>();
  const rows = db
    .prepare(
      `SELECT line_id, asset_id, data FROM asset_lines
        WHERE type = 'translation' AND json_extract(additional, '$.language') = ?`,
    )
    .all(language) as { line_id: string; asset_id: string; data: string }[];
  for (const r of rows) {
    const k = rank.get(r.asset_id);
    if (k === undefined || !r.data.trim()) continue;
    const cur = best.get(r.line_id);
    if (!cur || k < cur.rank) best.set(r.line_id, { rank: k, text: r.data.trim().replace(/\s+/g, ' ') });
  }
  return best;
}

function main(): void {
  const dbPath = resolve(process.argv[2] ?? 'assets/shabados/master.sqlite');
  const corpusPath = resolve(process.argv[3] ?? 'resources/corpus.json.gz');
  const outPath = resolve(process.argv[4] ?? 'resources/meanings.json.gz');
  const corpus = JSON.parse(gunzipSync(readFileSync(corpusPath)).toString('utf8')) as { lines: { id: string[] } };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const pa = pick(db, 'pa', MEANING_SOURCES);
  const en = pick(db, 'en', ENGLISH_SOURCES);

  const ids = corpus.lines.id;
  const file: MeaningsFile = {
    version: 2,
    provenance: 'Shabad OS Database 5.0.0-next.0 (translations cited in its README)',
    sources: MEANING_SOURCES,
    pa: ids.map((id) => pa.get(id)?.text ?? ''),
    paSource: ids.map((id) => pa.get(id)?.rank ?? -1),
    enSources: ENGLISH_SOURCES,
    en: ids.map((id) => en.get(id)?.text ?? ''),
    enSource: ids.map((id) => en.get(id)?.rank ?? -1),
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(file)), { level: 9 });
  writeFileSync(outPath, gz);
  const counts = (sources: { id: string }[], of: number[]) => sources.map((s, i) => `${s.id} ${of.filter((x) => x === i).length}`).join(', ');
  console.log(`wrote ${outPath}: ${(gz.length / 1e6).toFixed(1)} MB`);
  console.log(`  Punjabi: ${counts(MEANING_SOURCES, file.paSource)}; none: ${file.paSource.filter((x) => x < 0).length} of ${ids.length}`);
  console.log(`  English: ${counts(ENGLISH_SOURCES, file.enSource)}; none: ${file.enSource.filter((x) => x < 0).length} of ${ids.length}`);
}

if (require.main === module) main();
