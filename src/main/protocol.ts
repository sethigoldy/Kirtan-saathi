/** Messages between the renderer and the engine utility process. */

import type { EngineMode } from '../engine/mode';

export type { EngineMode };

export type ToEngine =
  | { type: 'audio'; samples: Float32Array }
  | { type: 'mode'; mode: EngineMode }
  | { type: 'lock'; shabad: number; line?: number | null }
  | { type: 'setLine'; line: number }
  | { type: 'step'; offset: number }
  | { type: 'reset' }
  | { type: 'search'; query: string };

export interface UiLine {
  line: number;
  inShabad: number;
  text: string;
  role: number;
}

export interface UiShabad {
  index: number;
  id: string;
  source: string;
  section: string;
  author: string;
  page: number;
  lines: UiLine[];
}

export interface UiCandidate {
  shabad: number;
  line: number;
  text: string;
  source: string;
  page: number;
  score: number;
  evidence: number;
}

export interface UiEvent {
  t: number;
  state: 'listening' | 'searching' | 'locked';
  shabad: number | null;
  line: number | null;
  confidence: number;
  reason: string;
  mode: EngineMode['kind'];
  stream: string | null;
  candidates: UiCandidate[];
  asrText: string;
  inferMs: number;
  windowSec: number;
  paceScale: number;
}

export type FromEngine =
  | {
      type: 'ready';
      lines: number;
      shabads: number;
      threads: number;
      loadMs: number;
      selfTestRtf: number;
      provenance: string;
      banis: { id: string; name: string; nameEn: string; lines: number }[];
    }
  | { type: 'error'; message: string }
  | { type: 'event'; ev: UiEvent }
  | { type: 'shabad'; shabad: UiShabad | null }
  | { type: 'searchResults'; query: string; results: UiCandidate[] };
