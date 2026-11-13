"""Bounded lexical coordinate bounds plus explicitly sampled JSON geometry checks.

The full-file coordinate scan is lexical, NOT full JSON/geometry validation.
Checks coordinate-pair syntax across block boundaries with a 256-byte overlap.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import re
import time

import ijson
import numpy as np
from shapely.geometry import shape
from shapely import get_num_coordinates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--report', type=Path, default=Path('docs/flood-source-validation.json'))
    parser.add_argument('--sample-features', type=int, default=1000)
    parser.add_argument('--bounds-json', type=Path, help='Use compiled lexical scanner result')
    args = parser.parse_args()
    started = time.monotonic()
    sample = Counter()
    geometry_types = Counter()
    invalid_examples = []
    with args.source.open('rb') as source:
        for index, feature in enumerate(ijson.items(source, 'features.item', use_float=True)):
            geometry = shape(feature['geometry'])
            sample['features'] += 1
            sample['vertices'] += int(get_num_coordinates(geometry))
            geometry_types[geometry.geom_type] += 1
            sample['empty'] += int(geometry.is_empty)
            sample['invalid'] += int(not geometry.is_valid)
            if not geometry.is_valid and len(invalid_examples) < 10:
                invalid_examples.append(index)
            if index + 1 >= args.sample_features:
                break
    if args.bounds_json:
        lexical = json.loads(args.bounds_json.read_text())
        assert lexical['source_bytes'] == args.source.stat().st_size
        bounds = lexical['lexical_bounds']
        pairs = lexical['lexical_coordinate_pair_count']
    else:
        pattern = re.compile(rb'\[\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\]')
        bounds = [math.inf, math.inf, -math.inf, -math.inf]
        pairs = 0
        processed = 0
        carry = b''
        with args.source.open('rb') as source:
            while True:
                block = source.read(8 * 1024 * 1024)
                data = carry + block
                cutoff = max(0, len(data) - 256) if block else len(data)
                matches = []
                consumed = cutoff
                for match in pattern.finditer(data):
                    if match.start() >= cutoff:
                        break
                    matches.append((match[1], match[2]))
                    consumed = max(consumed, match.end())
                if matches:
                    values = np.asarray(matches, dtype=np.float64)
                    assert np.isfinite(values).all()
                    low, high = values.min(axis=0), values.max(axis=0)
                    bounds = [min(bounds[0], float(low[0])), min(bounds[1], float(low[1])),
                              max(bounds[2], float(high[0])), max(bounds[3], float(high[1]))]
                    pairs += len(matches)
                processed += len(block)
                carry = data[consumed:]
                if processed // (1024**3) != (processed-len(block)) // (1024**3):
                    print(json.dumps({'bytes_scanned': processed, 'percent': round(100*processed/args.source.stat().st_size, 1), 'seconds': round(time.monotonic()-started)}), flush=True)
                if not block:
                    break
    assert -180 <= bounds[0] <= bounds[2] <= 180
    assert -90 <= bounds[1] <= bounds[3] <= 90
    report = {'source': str(args.source), 'source_bytes': args.source.stat().st_size,
              'lexical_coordinate_pair_count': pairs, 'lexical_bounds': bounds,
              'sample': sample, 'sample_geometry_types': geometry_types,
              'invalid_sample_feature_indexes_zero_based': invalid_examples,
              'sample_method': 'First N features, not a random or geographically representative sample',
              'limits': 'Full-file lexical coordinate-pair scan; not full JSON or national geometry validation. Property inventory is separate.',
              'elapsed_seconds': round(time.monotonic()-started),
              'elapsed_seconds_scope': 'Python sample and report only; external bounds scan excluded' if args.bounds_json else 'Python scan and sample',
              'lexical_method': 'External compiled coordinate-pair scanner, full source byte count verified' if args.bounds_json else 'Python coordinate-pair regex, full source'}
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
