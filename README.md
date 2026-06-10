# vcfclick-demo

Pure-static page hosted on GitHub Pages. DuckDB-Wasm runs the cohort
SQL in the visitor's browser; visitors bring their own Anthropic API
key (kept in their browser's localStorage, never sent anywhere except
`api.anthropic.com`). No server, no secrets to manage, no rate-limit
exposure on my account.

## What's here

```
src/
  app.html, app.css                  global page shell + Tailwind v4
  routes/+layout.svelte              shell
  routes/+page.svelte                the demo UI (ask, SQL panel,
                                     results, settings drawer)
  lib/duckdb.ts                      DuckDB-Wasm init + query helper
  lib/llm.ts                         browser-direct Anthropic call
                                     with anthropic-dangerous-
                                     direct-browser-access: true
  lib/schema-briefing.ts             schema briefing handed to the
                                     model — sparse-aware AF pattern
static/demo-data/                    MVP cohort: tiny test fixture
                                     (5 variants × 3 samples)
.github/workflows/deploy.yml         build + publish on push to main
```

## MVP cohort

`static/demo-data/` is the vcfclick test fixture dumped to Parquet.
5 variants × 3 samples — proves the wiring; not a useful demo
dataset. The "next steps" section below covers swapping in real
1000G chr21.

## Local dev

```bash
bun install
bun run dev
```

Open the page, click "⚙ set API key", paste your Anthropic key
(`sk-ant-…`), then ask a question. The key stays in your browser.

## Deploy to GitHub Pages

The workflow at `.github/workflows/deploy.yml` runs on every push to
`main`, builds with `BASE_PATH=/vcfclick-demo`, and publishes to
GitHub Pages. One-time setup:

1. **Push to GitHub:** create the repo as `nuin/vcfclick-demo`.
2. **Enable Pages:** repo Settings → Pages → "Build and deployment"
   source = "GitHub Actions".
3. **Push to `main`:** workflow builds + publishes; URL appears in
   the Actions run output (typically
   `https://nuin.github.io/vcfclick-demo/`).

If you wire a custom domain (e.g. `demo.vcfclick.io`), set
`BASE_PATH: ''` in `.github/workflows/deploy.yml` and add a
`static/CNAME` file containing the domain.

## Loading a real cohort

The MVP fixture is too small to demonstrate anything. To run against
real 1000 Genomes chr21:

```bash
# In the main vcfclick repo
bcftools view -r chr21 \
    https://ftp.ebi.ac.uk/1000g/.../ALL.chr21.shapeit2_integrated_v1a.GRCh38.20181129.phased.vcf.gz \
  | bgzip > /tmp/chr21.vcf.gz

VCFCLICK_BACKEND=duckdb vcfclick db create chr21
VCFCLICK_BACKEND=duckdb vcfclick db ingest chr21 /tmp/chr21.vcf.gz \
    --cohort 1KG --ingest-id phase3
VCFCLICK_BACKEND=duckdb vcfclick db dump chr21 --out /tmp/chr21-dump
```

The full chr21 genotypes parquet is ~150 MB, which is **over
GitHub's 100 MB per-file limit**. Two options:

- **Host the parquet on GitHub Releases** (2 GB per file allowed),
  reference its public URL via the `VITE_DEMO_DATA_BASE` build-time
  env var.
- **Host on Cloudflare R2 / public S3 / any CDN** with CORS enabled
  for the GH Pages origin, then point `VITE_DEMO_DATA_BASE` at it.

Once the URL exists:

```bash
# Override at build time in .github/workflows/deploy.yml
env:
  BASE_PATH: /vcfclick-demo
  VITE_DEMO_DATA_BASE: https://github.com/nuin/vcfclick-demo/releases/download/data-v1
```

## Trust + privacy notes for visitors

The page makes exactly two kinds of network calls:

1. **Cohort Parquet files** fetched from `VITE_DEMO_DATA_BASE` (HTTP
   range reads, no credentials).
2. **Anthropic Messages API** at `https://api.anthropic.com/v1/messages`,
   using the visitor's own key supplied via the settings drawer. The
   key is stored in localStorage on their device and never sent
   elsewhere.

There is no analytics, no telemetry, no server-side logging — there
is no server. The page is 100% static files on GitHub Pages.
