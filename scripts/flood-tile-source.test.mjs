import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFloodTileSource } from '../src/lib/flood-tile-source.ts';

test('segmented tile reads cross boundaries, clamp EOF, reject bad ranges and abort', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: 'http://localhost:4321' } };
  const archive = Uint8Array.from({ length: 19 }, (_, index) => index);
  const requests = [];
  let badRange = false;
  let unsafeUrl = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('.json')) {
      return Response.json({ version: 'test-version', size: 19, chunkSize: 8,
        chunks: unsafeUrl ? ['https://example.com/data/a', 'b', 'c'] : ['a', 'b', 'c'] });
    }
    const part = ['a', 'b', 'c'].indexOf(new URL(url).pathname.split('/').pop());
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range).map(Number);
    requests.push([part, start, end]);
    const length = Math.min(8, 19 - part * 8);
    return new Response(archive.slice(part * 8 + start, part * 8 + end + 1), {
      status: 206, headers: { 'Content-Range': badRange ? 'bytes 0-0/1' : `bytes ${start}-${end}/${length}` },
    });
  };
  try {
    const source = await loadFloodTileSource();
    assert.equal(source.getKey(), 'http://localhost:4321/data/flood-zones.pmtiles');
    const range = await source.getBytes(6, 12);
    assert.deepEqual([...new Uint8Array(range.data)], [...archive.slice(6, 18)]);
    assert.deepEqual(requests, [[0, 6, 7], [1, 0, 7], [2, 0, 1]]);
    assert.equal(range.etag, 'test-version');
    assert.equal((await source.getBytes(17, 20)).data.byteLength, 2);
    await assert.rejects(source.getBytes(-1, 2), RangeError);
    await assert.rejects(source.getBytes(0, 3, undefined, 'old-version'));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(source.getBytes(0, 1, abort.signal), { name: 'AbortError' });
    badRange = true;
    await assert.rejects(source.getBytes(0, 1), /Content-Range/);
    unsafeUrl = true;
    await assert.rejects(loadFloodTileSource(), /same-origin/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
