import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// DuckDB-Wasm ships large .wasm + worker bundles that Vite would
	// otherwise warn about. Exclude from dep-optimization to avoid
	// double-bundling, and let it serve from node_modules at dev time.
	optimizeDeps: {
		exclude: ['@duckdb/duckdb-wasm']
	},
	worker: {
		format: 'es'
	}
});
