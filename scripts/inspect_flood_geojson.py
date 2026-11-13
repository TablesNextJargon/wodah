"""Inventory property strings without loading a national GeoJSON into memory.

This is a lexical inventory, not JSON or geometry validation. Uses bounded
chunks; matches crossing chunk boundaries are retained until complete.
"""

import argparse
from collections import Counter
import json
from pathlib import Path
import re


def inspect(path):
    pattern = re.compile(rb'"(origin|flood_zone|flood_source)"\s*:\s*"([^"\\]*)"')
    counts = {key: Counter() for key in ('origin', 'flood_zone', 'flood_source')}
    carry = b''
    with path.open('rb') as source:
        while block := source.read(8 * 1024 * 1024):
            data = carry + block
            cutoff = max(0, len(data) - 4096)
            consumed = cutoff
            for match in pattern.finditer(data):
                if match.start() >= cutoff:
                    break
                counts[match[1].decode()][match[2].decode()] += 1
                consumed = max(consumed, match.end())
            carry = data[consumed:]
        for match in pattern.finditer(carry):
            counts[match[1].decode()][match[2].decode()] += 1
    return {'file': path.name, 'bytes': path.stat().st_size,
            'method': 'Lexical property inventory; not geometry validation',
            'properties': counts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(args.path), indent=2))
