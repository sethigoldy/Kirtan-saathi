/**
 * kirtan: identify a shabad and track lines inside it (repeats, rahao).
 * paath:  identify a position and follow recitation forward through the
 *         source in reading order, across shabad boundaries.
 * bani:   follow a chosen bani's line list (Japji, Rehras, Sukhmani, ...).
 *
 * Kept free of imports so the renderer can use the type.
 */
export type EngineMode = { kind: 'kirtan' } | { kind: 'paath' } | { kind: 'bani'; id: string };
