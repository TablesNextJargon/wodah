"""Build browser-ready England flood vector tiles from the source GeoJSON.

Requires Tippecanoe 2.79+. Conversion runs offline, never in a Vercel build.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time

from split_flood_archive import publish


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--tippecanoe', default='tippecanoe')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    staging = root / '.data-build'
    staging.mkdir(exist_ok=True)
    source = args.source.resolve(strict=True)
    output = staging / 'flood-zones.pmtiles'
    if output.exists():
        parser.error(f'Remove the previous staging artifact before rebuilding: {output}')
    command = [args.tippecanoe, '-o', str(output), '-l', 'flood_zones',
               '-Z4', '-z12', '--no-feature-limit', '--no-tile-size-limit',
               '--no-tiny-polygon-reduction-at-maximum-zoom',
               '--include=flood_zone', '--include=origin', '--include=flood_source',
               '--attribution=Flood zones © Environment Agency',
               '--name=England Flood Zones 2 and 3',
               '--description=Simplified planning flood extents from supplied EA GeoJSON; source date unverified.',
               '--temporary-directory=' + str(staging), '--progress-interval=10', str(source)]
    started = time.monotonic()
    subprocess.run(command, check=True)
    # Publish only a completed archive. Keep the source out of public/ and Git.
    manifest = publish(output, root / 'public/data')
    report = {'source_file': source.name, 'source_bytes': source.stat().st_size,
              'archive_bytes': manifest['size'], 'archive_sha256': manifest['version'],
              'source_layer': 'flood_zones',
              'min_zoom': 4, 'max_zoom': 12, 'elapsed_seconds': round(time.monotonic()-started),
              'command': command, 'source_publication_date': 'unverified'}
    (root / 'docs/flood-tiles-build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
