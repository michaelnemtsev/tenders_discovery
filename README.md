# Australia Tender Discovery

A simple scaffold for a Claude routine that performs a deep search of all Australian government tenders.

## Goal

- Build an app that identifies official Australian tender portals.
- Ignore paid aggregator services and commercial marketplaces.
- Provide a strong prompt for Claude to perform a comprehensive, state-agnostic tender search.

## Files

- `src/tender_discovery.py` - core scaffolding and prompt loader
- `prompts/deep_search_aus_tenders.txt` - comprehensive Claude search prompt
- `requirements.txt` - Python dependencies
- `output/tenders.json` - latest run produced by the daily Claude routine
- `output/daily/<date>.json` - archived snapshot of each day's run
- `output/aggregate.json` - all days merged & de-duplicated (what the portal shows)
- `scripts/aggregate.js` - merges the daily snapshots into `aggregate.json`
- `web/` - static portal that displays, sorts, and filters the results
- `index.html` (root) - redirect to the portal (for hosted root URLs)

## Web portal

A dependency-free static portal in `web/` renders the routine's output
(`run_metadata`, `tenders`, `discovered_sources`).

**Run it (recommended — enables auto-loading the live export):**

```sh
# from the project root — zero dependencies, uses Node's stdlib
npm start
# then open http://localhost:8000/web/   (PORT=3000 npm start for another port)
```

(`python -m http.server 8000` also works if you prefer.) Served this way, the
portal automatically fetches `../output/tenders.json` and shows it (badge:
"Live export").

**Or just open it directly:** double-click `web/index.html`. Browsers block
`file://` fetches, so it falls back to bundled sample data (badge: "Sample
data"). Use the **Load JSON…** button or drag-and-drop a `tenders.json`
export onto the page to view real results.

Features: full-text search; faceted filters (source type, state/jurisdiction,
procurement type, status, access); **month filter** and **new / active in
latest run** toggles; "closing within" window; sort by closing date / publish
date / value / title; card and table views; a Discovered Sources tab; and a
Coverage tab. The portal loads `output/aggregate.json` first and falls back to
`output/tenders.json`, then to bundled sample data.

## Daily accumulation (monthly view)

Results accumulate over time so you get a running monthly / all-time view —
no database, just JSON files in the repo.

Each day:

1. The Claude routine writes its results to `output/tenders.json`
   (schema: `run_metadata`, `tenders`, `discovered_sources`).
2. Run the aggregator:

   ```sh
   npm run aggregate
   ```

   This copies the run into `output/daily/<run_date>.json` (idempotent), then
   merges **all** daily snapshots into `output/aggregate.json`, de-duplicating
   tenders by `dedup_key` and tracking `first_seen`, `last_seen`, `seen_count`,
   `is_new_in_latest` and `active_in_latest`.
3. Commit & push `output/` (and the portal). The hosted site updates.

The portal's **Discovered in month** dropdown and the **New / Active in latest
run** toggles all run off these accumulated fields.

## Hosting (GitHub Pages or Vercel)

The portal is fully static (HTML/CSS/JS + JSON), so it can't write files
itself — accumulation happens at routine time (step 2 above), and the host
just serves the committed JSON. Both options below are free and need no build.

**GitHub Pages** — simplest if the data lives in the repo:

1. Push this repo to GitHub.
2. Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
3. Open `https://<user>.github.io/<repo>/` (the root `index.html` redirects to
   the portal). The `.nojekyll` file ensures all JSON is served as-is.

**Vercel** — same files, nicer URLs and auto-deploy on push:

1. Import the GitHub repo at vercel.com (Framework preset: *Other*, no build
   command, output directory `.`).
2. Every push redeploys automatically; open the project URL.

Either way the daily flow is identical: routine writes JSON → `npm run
aggregate` → `git commit && git push`. Vercel only adds value if you later
want serverless endpoints (e.g. POST results instead of committing); for
git-committed JSON, Pages and Vercel are equivalent. See the comparison the
assistant provided for details.

## Next steps

1. Review the `prompts/deep_search_aus_tenders.txt` prompt.
2. Connect Claude as a routine that writes results to `output/tenders.json`.
3. Have the routine run `npm run aggregate` and commit `output/` each day.
