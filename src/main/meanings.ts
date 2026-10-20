/**
 * Bundled meanings (arth), aligned with the corpus line index.
 * Built by src/cli/build-meanings.ts into resources/meanings.json.gz.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export interface MeaningLookup {
  pa(line: number): string;
  /** Hindi translation ('' when none is bundled). */
  hi(line: number): string;
  /** Short credit for the line's Punjabi arth, e.g. "Prof. Sahib Singh". */
  credit(line: number): string;
}

interface MeaningsFile {
  sources: { id: string; name: string }[];
  pa: string[];
  paSource: number[];
  hi?: string[];
}

export class Meanings implements MeaningLookup {
  private constructor(private readonly file: MeaningsFile) {}

  static load(path: string): Meanings {
    return new Meanings(JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as MeaningsFile);
  }

  /** For tests. */
  static from(file: MeaningsFile): Meanings {
    return new Meanings(file);
  }

  pa(line: number): string {
    return this.file.pa[line] ?? '';
  }

  hi(line: number): string {
    return this.file.hi?.[line] ?? '';
  }

  credit(line: number): string {
    const s = this.file.sources[this.file.paSource[line] ?? -1];
    return s ? s.name.split(',')[0] : '';
  }
}
