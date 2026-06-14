/**
 * Browser-side DuckDB wrapper.
 *
 * vcfclick stores cohort variant data as a small set of Parquet files
 * (variants.parquet / genotypes.parquet / samples.parquet) with the
 * schemas locked in ingest/_arrow.py. DuckDB-Wasm reads Parquet over
 * HTTP range requests, so the demo only downloads the row groups and
 * columns each query actually touches — no need to pre-load the
 * full cohort.
 *
 * The Parquet URLs are configured at build time via the
 * VITE_DEMO_DATA_BASE env var (e.g.
 * https://demo-data.vcfclick.io/1kg-chr21). For local dev, the
 * static/demo-data/ files are served by Vite from the same origin.
 */

import * as duckdb from '@duckdb/duckdb-wasm';

/**
 * Normalized load-progress event. `fraction` is 0..1 when a byte total
 * is known (engine download on a cold cache), or null for an
 * indeterminate stage (cached engine, view registration). The page
 * renders `label` as status text and `fraction` as a bar width.
 */
export interface LoadProgress {
	label: string;
	fraction: number | null;
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

async function init(onProgress?: (p: LoadProgress) => void): Promise<duckdb.AsyncDuckDB> {
	onProgress?.({ label: 'Selecting query engine…', fraction: null });

	// MVP bundle: use the auto-selected platform bundle from JSDelivr.
	// For production swap to bundled-with-app assets in static/duckdb/
	// to avoid the cross-origin worker boot.
	const bundles = duckdb.getJsDelivrBundles();
	const bundle = await duckdb.selectBundle(bundles);
	const worker_url = URL.createObjectURL(
		new Blob([`importScripts("${bundle.mainWorker}");`], {
			type: 'text/javascript'
		})
	);
	const worker = new Worker(worker_url);
	const logger = new duckdb.ConsoleLogger();
	const db = new duckdb.AsyncDuckDB(logger, worker);

	onProgress?.({ label: 'Downloading query engine…', fraction: 0 });
	// instantiate's third arg is a progress callback reporting
	// {bytesRead, bytesTotal} as the wasm bundle streams in. On a warm
	// browser cache this fires once at ~100% and returns immediately.
	await db.instantiate(bundle.mainModule, bundle.pthreadWorker, (p) => {
		const total = p?.bytesTotal ?? 0;
		const loaded = p?.bytesLoaded ?? 0;
		const fraction = total > 0 ? Math.min(loaded / total, 1) : null;
		const mb = (loaded / 1_000_000).toFixed(1);
		onProgress?.({ label: `Downloading query engine… ${mb} MB`, fraction });
	});
	URL.revokeObjectURL(worker_url);
	return db;
}

/** Idempotent. Returns the same DB across calls. */
export function getDuckDB(onProgress?: (p: LoadProgress) => void): Promise<duckdb.AsyncDuckDB> {
	if (!dbPromise) dbPromise = init(onProgress);
	return dbPromise;
}

/**
 * Register the cohort's Parquet files as virtual tables. After this,
 * `SELECT * FROM variants` etc. work as if they were native tables.
 *
 * The schemas are the same locked Arrow schemas the chDB backend uses
 * (variants: 46 cols; genotypes: 28 cols; samples: 5 cols). The MCP
 * briefing relies on these names, so anything we change here has to
 * change there too.
 */
export async function registerCohort(
	dataBase: string,
	onProgress?: (p: LoadProgress) => void
): Promise<void> {
	const db = await getDuckDB(onProgress);
	const conn = await db.connect();
	try {
		const tables = ['variants', 'genotypes', 'samples'];
		for (let i = 0; i < tables.length; i++) {
			const t = tables[i];
			onProgress?.({
				label: `Connecting to cohort (${t})…`,
				// Coarse determinate progress across the three views.
				fraction: i / tables.length
			});
			const url = `${dataBase}/${t}.parquet`;
			// CREATE VIEW resolves the parquet schema (a small footer
			// range read), not the full file — huge cohorts don't sit
			// in browser memory; row groups stream lazily per query.
			await conn.query(
				`CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${url}')`
			);
		}
		onProgress?.({ label: 'Ready', fraction: 1 });
	} finally {
		await conn.close();
	}
}

/**
 * Hard cap on rows pulled out of a result. The cohort has 36.8M
 * genotype rows; a model coaxed into `SELECT * FROM genotypes` with no
 * LIMIT would, under an eager `conn.query()`, materialize the whole
 * thing into WASM memory and then the DOM — crashing the tab. Streaming
 * with an early stop means DuckDB only range-reads enough parquet
 * row-groups to fill this cap.
 */
export const MAX_RESULT_ROWS = 1000;

export interface QueryResult {
	columns: string[];
	rows: unknown[][];
	ms: number;
	/** True if the result was cut off at MAX_RESULT_ROWS. */
	truncated: boolean;
}

/**
 * Guard the browser demo from SQL shapes that DuckDB-Wasm has to fully
 * aggregate or sort before the streaming row cap can help. Broad
 * genotype-table aggregations are correct for the CLI/chDB story, but
 * too heavy for the public in-browser demo.
 */
export function validateDemoSql(sql: string): void {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ');
	if (!/\bfrom\s+genotypes\b|\bjoin\s+genotypes\b/.test(normalized)) return;

	const hasAggregation = /\bgroup\s+by\b|\border\s+by\b|\bsum\s*\(|\bcount\s*\(/.test(
		normalized
	);
	if (!hasAggregation) return;

	const hasRegionFilter =
		/\bchrom\s*=\s*['"]?chr/.test(normalized) &&
		/\bpos\s+between\b|\bpos\s*[<>=]/.test(normalized);
	if (hasRegionFilter) return;

	throw new Error(
		'This genotype-table query would use too much browser memory in the public demo. ' +
			'Ask for a smaller region such as chr21:18M-20M, or rank variants by the ' +
			'precomputed variants.info_AF column instead.'
	);
}

/**
 * Run a single read-only SQL statement and return up to
 * MAX_RESULT_ROWS rows. Streaming (`conn.send`) rather than eager
 * (`conn.query`) so an unbounded scan stops pulling once the cap is
 * hit instead of materializing the entire cohort.
 */
export async function query(sql: string): Promise<QueryResult> {
	const trimmed = sql.trim().replace(/;\s*$/, '');

	// Read-only guard: only SELECT / WITH may run. The parquet views are
	// the demo's whole world, but a model could still be talked into
	// DROP VIEW / CREATE / ATTACH and break the page for the session.
	if (!/^(select|with)\b/i.test(trimmed)) {
		throw new Error('Only SELECT queries are allowed in this demo.');
	}
	// Single statement only — a stray `;` mid-string would let a second
	// statement slip past the read-only check above.
	if (trimmed.includes(';')) {
		throw new Error('Only a single SQL statement is allowed.');
	}
	validateDemoSql(trimmed);

	const db = await getDuckDB();
	const conn = await db.connect();
	try {
		const started = performance.now();
		const reader = await conn.send(trimmed);

		let columns: string[] = [];
		const rows: unknown[][] = [];
		let truncated = false;

		for await (const batch of reader) {
			if (columns.length === 0) {
				columns = batch.schema.fields.map((f) => f.name);
			}
			for (const row of batch.toArray()) {
				rows.push(columns.map((c) => (row as Record<string, unknown>)[c]));
				if (rows.length >= MAX_RESULT_ROWS) {
					truncated = true;
					break;
				}
			}
			if (truncated) break;
		}

		// Stop DuckDB producing the rest of the result once we've capped.
		if (truncated) {
			try {
				await conn.cancelSent();
			} catch {
				// Best-effort; the connection close in `finally` is the
				// real cleanup.
			}
		}

		const ms = performance.now() - started;
		return { columns, rows, ms, truncated };
	} finally {
		await conn.close();
	}
}
