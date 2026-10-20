import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pacer, PACE_TIERS } from '../engine/pacer';

test('calibration picks a tier where a decode fits the hop', () => {
  const p = new Pacer();
  // Fast machine: 5 s decodes in 200 ms, hop 0.5 s -> tier 1x.
  p.calibrate(200, 5, 0.5, 5);
  assert.equal(p.scale, 1);
  // Slow machine: 5 s decodes in 900 ms -> needs 0.9 / 0.7 / 0.5 = 2.6x -> 3x.
  p.calibrate(900, 5, 0.5, 5);
  assert.equal(p.scale, 3);
});

test('sustained overruns step up; sustained headroom steps down', () => {
  const p = new Pacer();
  for (let i = 0; i < 3; i++) p.observe(450, 0.5); // 90% of a 0.5 s hop
  assert.equal(p.scale, PACE_TIERS[1]);
  for (let i = 0; i < 2; i++) p.observe(450, 0.5); // 60% of 0.75 s: within target
  assert.equal(p.scale, PACE_TIERS[1]);
  for (let i = 0; i < 20; i++) p.observe(100, 0.5); // 13%: headroom
  assert.equal(p.scale, PACE_TIERS[0]);
});

test('a single slow decode does not change the tier', () => {
  const p = new Pacer();
  p.observe(2000, 0.5);
  p.observe(100, 0.5);
  assert.equal(p.scale, 1);
});
