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

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

async function init(): Promise<duckdb.AsyncDuckDB> {
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
	await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
	URL.revokeObjectURL(worker_url);
	return db;
}

/** Idempotent. Returns the same DB across calls. */
export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
	if (!dbPromise) dbPromise = init();
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
export async function registerCohort(dataBase: string): Promise<void> {
	const db = await getDuckDB();
	const conn = await db.connect();
	try {
		for (const t of ['variants', 'genotypes', 'samples']) {
			const url = `${dataBase}/${t}.parquet`;
			// CREATE VIEW reads the file lazily on each query, so
			// huge cohorts don't sit in browser memory.
			await conn.query(
				`CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_parquet('${url}')`
			);
		}
	} finally {
		await conn.close();
	}
}

/** Run one SQL statement and return rows + column names. */
export async function query(
	sql: string
): Promise<{ columns: string[]; rows: unknown[][]; ms: number }> {
	const db = await getDuckDB();
	const conn = await db.connect();
	try {
		const started = performance.now();
		const result = await conn.query(sql);
		const ms = performance.now() - started;
		const columns = result.schema.fields.map((f) => f.name);
		const rows = result
			.toArray()
			.map((r: unknown) =>
				columns.map((c) => (r as Record<string, unknown>)[c])
			);
		return { columns, rows, ms };
	} finally {
		await conn.close();
	}
}
