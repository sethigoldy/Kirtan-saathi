import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { compareVersions, latestRelease, RELEASES_PAGE, whatsNew } from '../main/update-check';
import { parseSettings } from '../main/settings';

const NOTES = `## What's new in 0.3.0

- **English meaning** under the tuk
- Full Punjabi app (\`App → Language\`)
- See [the guide](https://example.com)

## Download

- not a change
`;

test('versions compare numerically; v prefixes and pre-release suffixes are ignored', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.2.0', '0.2.1'), -1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.3.0-test.5', '0.2.0'), 1);
});

test("what's new takes only that section's items, as plain text", () => {
  assert.deepEqual(whatsNew(NOTES), ['English meaning under the tuk', 'Full Punjabi app (App → Language)', 'See the guide']);
  assert.deepEqual(whatsNew('## Download\n- a file'), [], 'no section, no items');
});

test('latest release from GitHub: version, notes, and only GitHub release links', async () => {
  let answer: unknown = {};
  const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/latest`;
  try {
    answer = { tag_name: 'v0.3.0', html_url: `${RELEASES_PAGE}/tag/v0.3.0`, body: NOTES };
    assert.deepEqual(await latestRelease(url), { version: '0.3.0', url: `${RELEASES_PAGE}/tag/v0.3.0`, notes: whatsNew(NOTES) });
    answer = { tag_name: 'v0.3.0', html_url: 'https://evil.example/x', body: '' };
    assert.equal((await latestRelease(url))?.url, RELEASES_PAGE, 'only the project release page is opened');
    answer = { tag_name: 'v0.4.0-test.1', prerelease: true };
    assert.equal(await latestRelease(url), null, 'test builds are not offered');
  } finally {
    server.close();
  }
  await assert.rejects(latestRelease(url, 2000), 'an unreachable server is an error (the app stays quiet)');
});

test('update settings: check on and automatic install off by default, kept when valid', () => {
  assert.deepEqual(parseSettings({}).updates, { check: true, auto: false });
  assert.deepEqual(parseSettings({ updates: { check: false, auto: true } }).updates, { check: false, auto: true });
  assert.deepEqual(parseSettings({ updates: { check: 'yes', auto: 1 } }).updates, { check: true, auto: false });
});
