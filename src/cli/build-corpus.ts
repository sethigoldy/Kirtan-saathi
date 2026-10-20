/**
 * Build resources/corpus.json.gz from the Shabad OS Database 5.x SQLite file.
 *
 * Usage: node dist/cli/build-corpus.js [path/to/master.sqlite] [out.json.gz]
 *
 * Shabad OS 5.x states that Gurbani text in its releases is in the public
 * domain (with derogatory alteration forbidden), and its code is MIT.
 * The text is copied verbatim; only derived fields (roles) are added.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
// node:sqlite is built into Node >= 22.5 (experimental).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import type { CorpusFile } from '../engine/corpus';
import { deriveRole } from '../engine/gurmukhi';

const SOURCE_ORDER = ['SGGS', 'SDGR', 'VBGJ', 'KSBG', 'GZNL', 'ZNNL', 'GJNL', 'JBNL', 'SRBL', 'ARDS'];

/** Display names (the database's `translation` field holds literal meanings). */
const SOURCE_NAMES: Record<string, string> = {
  SGGS: 'Sri Guru Granth Sahib',
  SDGR: 'Sri Dasam Granth',
  VBGJ: 'Vaaran Bhai Gurdas',
  KSBG: 'Kabit Savaiye Bhai Gurdas',
  GZNL: 'Ghazals Bhai Nand Lal',
  ZNNL: 'Zindagi Nama Bhai Nand Lal',
  GJNL: 'Ganj Nama Bhai Nand Lal',
  JBNL: 'Jot Bigas Bhai Nand Lal',
  SRBL: 'Sarabloh Granth',
  ARDS: 'Ardas',
};

function parseName(json: string | null, ...keys: string[]): string {
  if (!json) return '';
  try {
    const o = JSON.parse(json) as Record<string, string>;
    for (const k of keys) if (o[k]) return o[k];
    return Object.values(o)[0] ?? '';
  } catch {
    return json;
  }
}

function main(): void {
  const dbPath = resolve(process.argv[2] ?? 'assets/shabados/master.sqlite');
  const outPath = resolve(process.argv[3] ?? 'resources/corpus.json.gz');
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const sourceRows = db.prepare('SELECT id, name, translation FROM sources').all() as {
    id: string; name: string; translation: string;
  }[];
  const sourceRank = (id: string) => {
    const r = SOURCE_ORDER.indexOf(id);
    return r < 0 ? SOURCE_ORDER.length : r;
  };
  sourceRows.sort((a, b) => sourceRank(a.id) - sourceRank(b.id) || a.id.localeCompare(b.id));
  const sourceIndex = new Map(sourceRows.map((s, i) => [s.id, i]));

  const authors = new Map(
    (db.prepare('SELECT id, name FROM authors').all() as { id: string; name: string }[]).map((a) => [
      a.id,
      parseName(a.name, 'Latn', 'Guru'),
    ]),
  );

  // One row per line with everything needed for ordering.
  const rows = db
    .prepare(
      `SELECT l.id AS line_id, l.line_group_id AS group_id, l.line_group_order AS line_order,
              g.author_id AS author_id, g.section_order AS group_order,
              s.id AS section_id, s.source_id AS source_id, s.source_order AS section_order, s.name AS section_name,
              a.data AS text, a.additional AS additional
         FROM lines l
         JOIN line_groups g ON g.id = l.line_group_id
         JOIN sections s ON s.id = g.section_id
         JOIN asset_lines a ON a.line_id = l.id AND a.type = 'primary'`,
    )
    .all() as {
    line_id: string; group_id: string; line_order: number; author_id: string; group_order: number;
    section_id: string; source_id: string; section_order: number; section_name: string;
    text: string; additional: string;
  }[];

  rows.sort(
    (a, b) =>
      sourceRank(a.source_id) - sourceRank(b.source_id) ||
      a.section_order - b.section_order ||
      a.group_order - b.group_order ||
      a.group_id.localeCompare(b.group_id) ||
      a.line_order - b.line_order,
  );

  const file: CorpusFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    provenance: {
      name: 'Shabad OS Database',
      version: '5.0.0-next.0',
      textLicense: 'Public domain (Shabad OS statement; derogatory alteration forbidden)',
      codeLicense: 'MIT',
      url: 'https://github.com/shabados/shabados/tree/main/database',
    },
    sources: sourceRows.map((s) => ({
      id: s.id,
      name: parseName(s.name, 'Guru'),
      nameEn: SOURCE_NAMES[s.id] ?? parseName(s.name, 'Latn'),
    })),
    shabads: [],
    lines: { id: [], text: [], page: [], role: [] },
    banis: [],
  };

  const lineIndexById = new Map<string, number>();
  let current: CorpusFile['shabads'][number] | null = null;
  for (const r of rows) {
    if (!current || current.id !== r.group_id) {
      const page = (JSON.parse(r.additional) as { page?: number }).page ?? 0;
      current = {
        id: r.group_id,
        source: sourceIndex.get(r.source_id) ?? 0,
        section: parseName(r.section_name, 'Latn', 'en'),
        author: authors.get(r.author_id) ?? '',
        page,
        start: file.lines.id.length,
        count: 0,
      };
      file.shabads.push(current);
    }
    const add = JSON.parse(r.additional) as { page?: number };
    lineIndexById.set(r.line_id, file.lines.id.length);
    file.lines.id.push(r.line_id);
    file.lines.text.push(r.text);
    file.lines.page.push(add.page ?? current.page);
    file.lines.role.push(deriveRole(r.text));
    current.count++;
  }

  const banis = db.prepare('SELECT id, name FROM banis').all() as { id: string; name: string }[];
  const baniLines = db
    .prepare('SELECT bani_id, line_id, section_order, line_order FROM bani_lines ORDER BY bani_id, section_order, line_order')
    .all() as { bani_id: string; line_id: string }[];
  for (const b of banis) {
    file.banis.push({
      id: b.id,
      name: parseName(b.name, 'Guru'),
      nameEn: parseName(b.name, 'Latn'),
      lines: baniLines
        .filter((l) => l.bani_id === b.id)
        .map((l) => lineIndexById.get(l.line_id))
        .filter((x): x is number => x !== undefined),
    });
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(file)), { level: 9 });
  writeFileSync(outPath, gz);
  const roles = [0, 0, 0, 0];
  for (const r of file.lines.role) roles[r]++;
  console.log(
    `wrote ${outPath}: ${file.lines.id.length} lines, ${file.shabads.length} shabads, ` +
      `${file.banis.length} banis, ${(gz.length / 1e6).toFixed(1)} MB; roles verse/rahao/header/mangal = ${roles.join('/')}`,
  );
}

main();
