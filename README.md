# vcfclick-demo

Static page + Cloudflare Pages Function. Visitors type a
population-genetics question in English; a language model (Anthropic
API via the Function) writes SQL; DuckDB-Wasm runs it in the browser
against a cohort served as Parquet over HTTP range reads. Visitors
see the SQL the model wrote.

## What's here

```
src/
  app.html, app.css                  global page shell + Tailwind v4
  routes/+page.svelte                the demo UI
  routes/api/complete/+server.ts     Anthropic proxy (Pages Function)
  lib/duckdb.ts                      DuckDB-Wasm init + query helper
  lib/schema-briefing.ts             schema briefing handed to the model
static/demo-data/                    MVP cohort (tiny fixture, 5 vars)
wrangler.toml                        Cloudflare Pages config
```

## MVP cohort

The committed `static/demo-data/` holds 5 variants × 3 samples from
the vcfclick test fixture (`tests/fixtures/tiny.vcf.gz`). It proves
the wiring; it's not a useful demo dataset. Real 1000G chr21 is
the next step (~200 MB, hosted on R2, see below).

## Local dev

```bash
bun install
bun run dev
```

The dev page tries to call `/api/complete`. To actually get answers
locally you need a real Anthropic key — set it in `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

Wrangler's dev runtime reads these for the Pages Function.

## Deploy to Cloudflare Pages

1. Create the Pages project (one-time):
   ```bash
   bun run build
   bunx wrangler pages deploy .svelte-kit/cloudflare \
       --project-name=vcfclick-demo
   ```
2. Set secrets via Wrangler or the Pages dashboard:
   ```bash
   bunx wrangler pages secret put ANTHROPIC_API_KEY --project-name=vcfclick-demo
   ```
3. Set non-secret env vars (Pages dashboard → Settings → Environment
   variables, or `wrangler.toml [vars]` block):
   * `ANTHROPIC_MODEL` (defaults to `claude-haiku-4-5-20251001`)
   * `VITE_DEMO_DATA_BASE` (defaults to `/demo-data`; set to the R2
     URL once chr21 is uploaded — see below)

## Loading a real cohort (1000G chr21)

Replace the toy 5-variant fixture with a real 1000G slice:

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

Upload to Cloudflare R2:

```bash
bunx wrangler r2 bucket create vcfclick-demo-data
bunx wrangler r2 object put vcfclick-demo-data/1kg-chr21/variants.parquet \
    --file=/tmp/chr21-dump/variants.parquet
bunx wrangler r2 object put vcfclick-demo-data/1kg-chr21/genotypes.parquet \
    --file=/tmp/chr21-dump/genotypes.parquet
bunx wrangler r2 object put vcfclick-demo-data/1kg-chr21/samples.parquet \
    --file=/tmp/chr21-dump/samples.parquet
```

Make the bucket publicly readable, then set
`VITE_DEMO_DATA_BASE=https://<your-bucket-public-url>/1kg-chr21` and
redeploy.

## Cost model

Idle: $0 (Pages + Workers free tier).

Per question: ~$0.005 with Haiku-tier model (2k input + 500 output
tokens). R2 reads have no egress fees. Compute is well under the
free tier.

Per-IP rate limiting via Cloudflare's Rate Limiting API is NOT yet
wired up — for production add a binding before opening the demo to
public traffic.

## What's still needed before public launch

1. Real cohort on R2 (above).
2. Anthropic API key as a Pages secret.
3. Rate limiting binding configured.
4. DNS: point `demo.vcfclick.io` at the Pages project.
5. Production smoke test of the `/api/complete` path.
