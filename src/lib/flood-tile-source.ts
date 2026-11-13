import { EtagMismatch, type RangeResponse, type Source } from 'pmtiles';

interface FloodTileManifest {
  version: string;
  size: number;
  chunkSize: number;
  chunks: string[];
}

const validateDataUrl = (value: string, baseUrl: URL): URL => {
  const url = new URL(value, baseUrl);
  if (
    url.origin !== baseUrl.origin ||
    !['http:', 'https:'].includes(url.protocol) ||
    !url.pathname.startsWith('/data/') ||
    url.pathname.includes('%') ||
    url.pathname.endsWith('/') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Flood archive URLs must be same-origin files under /data/.',
    );
  }
  return url;
};

const validateManifest = (
  value: unknown,
  manifestUrl: URL,
): FloodTileManifest => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid flood archive manifest.');
  }
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.version !== 'string' ||
    !manifest.version.trim() ||
    typeof manifest.size !== 'number' ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0 ||
    typeof manifest.chunkSize !== 'number' ||
    !Number.isSafeInteger(manifest.chunkSize) ||
    manifest.chunkSize <= 0 ||
    !Array.isArray(manifest.chunks) ||
    manifest.chunks.length !== Math.ceil(manifest.size / manifest.chunkSize)
  ) {
    throw new Error('Invalid flood archive manifest.');
  }
  const chunks = manifest.chunks.map((chunk: unknown): string => {
    if (typeof chunk !== 'string' || !chunk.trim()) {
      throw new Error('Invalid flood archive chunk URL.');
    }
    return validateDataUrl(chunk, manifestUrl).href;
  });
  return {
    version: manifest.version,
    size: manifest.size,
    chunkSize: manifest.chunkSize,
    chunks,
  };
};

class SegmentedFloodTileSource implements Source {
  private readonly manifest: FloodTileManifest;
  private readonly key: string;

  constructor(manifest: FloodTileManifest, key: string) {
    this.manifest = manifest;
    this.key = key;
  }

  getKey(): string {
    return this.key;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.manifest.size ||
      (offset === this.manifest.size && length > 0)
    ) {
      throw new RangeError('Flood archive byte range is out of bounds.');
    }
    if (etag !== undefined && etag !== this.manifest.version) {
      throw new EtagMismatch(
        'Flood archive version changed. Reload the manifest.',
      );
    }

    // PMTiles can request its initial header block beyond a small archive's end.
    const byteLength = Math.min(length, this.manifest.size - offset);
    const data = new ArrayBuffer(byteLength);
    const target = new Uint8Array(data);
    let written = 0;
    while (written < byteLength) {
      signal?.throwIfAborted();
      const position = offset + written;
      const chunkIndex = Math.floor(position / this.manifest.chunkSize);
      const chunkOffset = chunkIndex * this.manifest.chunkSize;
      const chunkLength = Math.min(
        this.manifest.chunkSize,
        this.manifest.size - chunkOffset,
      );
      const start = position - chunkOffset;
      const readLength = Math.min(byteLength - written, chunkLength - start);
      const end = start + readLength - 1;
      const response = await fetch(this.manifest.chunks[chunkIndex], {
        headers: { Range: `bytes=${start}-${end}` },
        signal,
        redirect: 'error',
        credentials: 'same-origin',
      });
      if (response.status !== 206) {
        throw new Error(
          `Flood archive chunk requires HTTP 206; received ${response.status}.`,
        );
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        response.headers.get('Content-Range') ?? '',
      );
      if (
        !range ||
        Number(range[1]) !== start ||
        Number(range[2]) !== end ||
        Number(range[3]) !== chunkLength
      ) {
        throw new Error(
          'Flood archive chunk returned an incorrect Content-Range.',
        );
      }
      const bytes = await response.arrayBuffer();
      signal?.throwIfAborted();
      if (bytes.byteLength !== readLength) {
        throw new Error(
          'Flood archive chunk returned an incorrect byte count.',
        );
      }
      target.set(new Uint8Array(bytes), written);
      written += readLength;
    }
    return { data, etag: this.manifest.version };
  }
}

/** Load the segmented archive descriptor; the synthetic key stays stable for PMTiles. */
export const loadFloodTileSource = async (
  signal?: AbortSignal,
): Promise<Source> => {
  signal?.throwIfAborted();
  const manifestUrl = new URL('/data/flood-zones.json', window.location.origin);
  const response = await fetch(manifestUrl.href, {
    signal,
    redirect: 'error',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(
      `Flood archive manifest could not load (HTTP ${response.status}).`,
    );
  }
  const value: unknown = await response.json();
  signal?.throwIfAborted();
  const manifest = validateManifest(value, manifestUrl);
  const key = new URL('/data/flood-zones.pmtiles', manifestUrl).href;
  return new SegmentedFloodTileSource(manifest, key);
};
