import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Project-level base path for GitHub Pages subpath deploys
// (e.g. https://nuin.github.io/vcfclick-demo/). Empty at the root.
// Override at build time via:
//   BASE_PATH=/vcfclick-demo bun run build
const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		paths: { base },
		// The demo is one route; static-render it so GH Pages can
		// serve the whole thing as files. fallback above handles
		// any deep-link via client-side routing if we ever add more.
		prerender: { entries: ['*'] }
	}
};

export default config;
