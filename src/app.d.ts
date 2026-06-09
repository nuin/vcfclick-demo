// Type declarations for the demo's SvelteKit app surface.
//
// Cloudflare Pages adapter exposes runtime bindings (env vars,
// KV namespaces, R2 buckets, ...) via the `platform` argument on
// every request handler. SvelteKit's Platform interface is empty
// by default; declare what we actually use here so server code is
// typed.

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				ANTHROPIC_API_KEY?: string;
				ANTHROPIC_MODEL?: string;
			};
		}
	}
}

export {};
