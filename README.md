# Wodah — England flood map

An interactive England map of Flood Zones 2 and 3 from rivers and the sea,
built with Astro 5, React, MapLibre GL JS 6, and PMTiles. It is a generalized
visual overview, unsuitable for property-level flood-risk decisions. Coverage
is England, not the whole UK, and does not include every source of flooding.

Switch between the OpenFreeMap cartographic basemap and Esri World Imagery
satellite/aerial imagery. Flood filters, opacity and inspection work on both.

## Run locally

```sh
npm ci
npm run dev
```

Build and check types with:

```sh
npm run build
npm run typecheck
```

The map needs the generated data assets in `public/data/`. Application builds
do not regenerate the national dataset.

## Flood data

Tippecanoe reads the original 15.8 GB GeoJSON directly and builds a PMTiles
archive at zooms 4–12, retaining `flood_zone`, `origin`, and `flood_source`.
The archive exceeds 100 MB, so static delivery uses files of at most **32 MiB**
plus the manifest at `/data/flood-zones.json`. The browser loads the manifest
and required archive segments rather than the national GeoJSON. Keep the
manifest and all its referenced segments together when copying or publishing.

Rebuild offline with Python 3 and Tippecanoe 2.79 or later:

```sh
python3 scripts/build_flood_tiles.py \
  /home/hadow/Downloads/Flood_Zones_2_3_Rivers_and_Sea.geojson
```

Use `--tippecanoe /path/to/tippecanoe` if it is not on `PATH`. The source file
stays outside the repository and public assets. See [data notes](docs/flood-data-notes.md)
for lineage, validation, generalization limits, and licence checks required
before redistribution.

## Verification

The build and type check pass. Browser verification covers real flood-tile
byte-range requests, polygon inspection, filters, opacity, satellite switching,
postcode response handling and the mobile tools panel.

```sh
node --experimental-strip-types --test scripts/flood-tile-source.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/browser-smoke.cjs
```

The browser check saves screenshots under ignored `test-results/`. Postcode
responses are intercepted in that check; basemap, imagery and flood tiles are
loaded from the real services and generated assets.
