# England flood map data

## Source and lineage

The input is the supplied Environment Agency
`Flood_Zones_2_3_Rivers_and_Sea.geojson`, **15,773,778,688 bytes**. Its declared
CRS is CRS84: longitude, latitude. Coverage is the supplied England dataset;
no additional country-boundary clipping is applied. It is not UK-wide and does
not cover every flood source, including separate surface-water risk mapping.

The source publication date and version are **unverified**. Confirm the
applicable licence, attribution wording, and redistribution conditions with
the supplier before publishing or distributing derived data. An attribution
in the map or archive is not evidence that those checks have been completed.

## Processing and delivery

`scripts/build_flood_tiles.py` runs Tippecanoe 2.79 or later directly against
the original GeoJSON. It produces vector tiles for zooms **4–12**, with source
layer `flood_zones` and the attributes `flood_zone`, `origin`, and `flood_source`.
Conversion is an offline task, separate from the application build.

The completed PMTiles archive exceeds 100 MB. Static delivery splits its bytes
into files of at most **32 MiB**, referenced by the manifest at
`/data/flood-zones.json`. The client requests the segments needed to read the
archive. Segmentation changes storage and retrieval, not the tile geometry;
keep the manifest and every referenced segment from the same build together.
The original national GeoJSON is not served to browsers.

Rebuild with:

```sh
python3 scripts/build_flood_tiles.py \
  /home/hadow/Downloads/Flood_Zones_2_3_Rivers_and_Sea.geojson
```

An explicit executable can be supplied with `--tippecanoe /path/to/tippecanoe`.
Use the build script and its generated report for the exact options and
artifact sizes.

## Display limitations

Vector tiles quantize coordinates to a tile grid, clip geometry at tile
boundaries, and generalize shapes according to zoom. Small components and
narrow details can be reduced or disappear at lower zooms. The build disables
feature-count and tile-size limits and disables tiny-polygon reduction at the
maximum zoom; these settings do not guarantee exact source geometry or visible
representation of every small component at every zoom. Above zoom 12, the map
can enlarge existing tiles but gains no additional flood-boundary detail.

There is no fixed 30-metre simplification tolerance in this pipeline. Tile
precision varies with zoom and location. Use this map for a national or regional
visual overview, not property-level risk assessment, planning decisions, exact
boundary queries, or area measurement. Consult authoritative supplier services
and current local information for those uses.

## Source checks

[The property inventory](flood-data-inventory.json) records **415,408 flood-zone
entries**. It is a lexical property count, not a full JSON or geometry check.

[The source-validation report](flood-source-validation.json) records a full-file
lexical scan of **356,860,517 coordinate pairs**, with observed bounds in
`[west, south, east, north]` order:

```text
[-6.366580965166898, 49.88224305617522, 1.763601627366952, 55.8116343134361]
```

Shapely checked the **first 1,000 features**: all were MultiPolygons, containing
682,459 vertices, with no empty or invalid geometries. This initial sample is
not random or geographically representative. Neither it nor the lexical scan
establishes national geometry validity, tile completeness, or agreement with
current supplier data. Source counts and tile feature counts are not directly
comparable because tiling clips and repeats features across tiles and zooms.
