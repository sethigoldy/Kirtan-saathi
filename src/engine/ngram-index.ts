/**
 * IDF-weighted n-gram inverted index over small-alphabet sequences.
 * Score(line) = sum of IDF of the query's distinct n-grams present in the
 * line, divided by sqrt(sum of IDF of the line's distinct n-grams).
 */
export class NgramIndex {
  private readonly gramStart: Int32Array;
  private readonly postings: Int32Array;
  private readonly idf: Float32Array;
  private readonly lineNorm: Float32Array;
  private readonly acc: Float32Array;
  private readonly grams: number;

  constructor(
    seqs: readonly Uint8Array[],
    readonly alphabet: number,
    readonly n: number,
    include: (i: number) => boolean,
    maxDfFraction: number,
  ) {
    this.grams = Math.pow(alphabet, n);
    const G = this.grams;
    const count = seqs.length;
    const df = new Int32Array(G);
    const seen = new Int32Array(G).fill(-1);
    let included = 0;
    for (let i = 0; i < count; i++) {
      if (!include(i)) continue;
      included++;
      this.forEachGram(seqs[i], (g) => {
        if (seen[g] !== i) { seen[g] = i; df[g]++; }
      });
    }
    this.gramStart = new Int32Array(G + 1);
    for (let g = 0; g < G; g++) this.gramStart[g + 1] = this.gramStart[g] + df[g];
    this.postings = new Int32Array(this.gramStart[G]);
    const cursor = this.gramStart.slice(0, G);
    seen.fill(-1);
    for (let i = 0; i < count; i++) {
      if (!include(i)) continue;
      this.forEachGram(seqs[i], (g) => {
        if (seen[g] !== i) { seen[g] = i; this.postings[cursor[g]++] = i; }
      });
    }
    this.idf = new Float32Array(G);
    const maxDf = Math.max(50, Math.floor(included * maxDfFraction));
    for (let g = 0; g < G; g++) {
      const d = df[g];
      this.idf[g] = d === 0 || d > maxDf ? 0 : Math.log(included / d);
    }
    this.lineNorm = new Float32Array(count);
    seen.fill(-1);
    for (let i = 0; i < count; i++) {
      if (!include(i)) continue;
      let s = 0;
      this.forEachGram(seqs[i], (g) => {
        if (seen[g] !== i) { seen[g] = i; s += this.idf[g]; }
      });
      this.lineNorm[i] = Math.sqrt(Math.max(s, 1));
    }
    this.acc = new Float32Array(count);
  }

  private forEachGram(seq: Uint8Array, fn: (g: number) => void): void {
    const n = this.n, a = this.alphabet;
    for (let p = 0; p + n <= seq.length; p++) {
      let g = 0;
      for (let k = 0; k < n; k++) g = g * a + seq[p + k];
      fn(g);
    }
  }

  /** Adds this index's scores into `out` (line -> score). */
  score(query: Uint8Array, out: Map<number, number>, weight = 1): void {
    const grams = new Set<number>();
    this.forEachGram(query, (g) => grams.add(g));
    const touched: number[] = [];
    const acc = this.acc;
    for (const g of grams) {
      const w = this.idf[g];
      if (w === 0) continue;
      for (let k = this.gramStart[g], e = this.gramStart[g + 1]; k < e; k++) {
        const line = this.postings[k];
        if (acc[line] === 0) touched.push(line);
        acc[line] += w;
      }
    }
    for (const line of touched) {
      out.set(line, (out.get(line) ?? 0) + (weight * acc[line]) / this.lineNorm[line]);
      acc[line] = 0;
    }
  }
}
