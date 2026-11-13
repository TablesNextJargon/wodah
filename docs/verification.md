# England flood explorer verification

- `npm run build`: passed, including the static root page and tile assets.
- `npm run typecheck`: zero errors, warnings or hints.
- Segmented-source test: passed cross-chunk reads, EOF clamping, bad range
  rejection, version mismatch, abort and same-origin manifest validation.
- SHA-256 verification: all 14 chunks reconstruct the completed 436,329,057-byte
  PMTiles archive exactly. Digest is in `flood-tiles-build.json`.
- Browser smoke: passed on desktop and mobile, 34 real HTTP 206 range responses,
  real Somerset polygon inspection, both zone toggles, opacity, deterministic
  England/Wales postcode response handling, focus and satellite switching.
- Real Esri satellite tiles returned HTTP 200; no browser page errors occurred.

Generated screenshots are local in `test-results/`. Postcode API responses are
intercepted in the automated journey; live geocoding availability is a runtime
external dependency. Satellite imagery and the cartographic basemap also need
network access. Flood tiles are included with the app.

The inherited Astro 5/Vercel dependency stack still reports 12 npm advisories
after compatible fixes (2 low, 3 moderate, 6 high, 1 critical). Resolving all of
them requires a separate major framework/adapter upgrade; no forced major
upgrade was applied. The new root map page is prerendered, with no data-conversion
or map API server work at runtime. Existing unrelated routes remain in the repo.

The app is deployed on Vercel project `trycvpilot`, with `wodah.com` and
`www.wodah.com` assigned. The project is connected to this repository's main
branch. Hosted PMTiles manifest and HTTP 206 byte ranges match the local assets.
The previous terrain deployment remains available in the project's history.

Vercel CLI initialized a Protection Bypass for Automation secret while testing
the protected preview. Its value was not printed or committed; access protection
was not disabled.
