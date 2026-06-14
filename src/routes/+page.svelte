<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { query, registerCohort, type LoadProgress } from '$lib/duckdb';
	import {
		complete,
		getProvider,
		setProvider,
		getKey,
		setKey,
		getModel,
		setModel,
		getKeyDocsUrl,
		getProviderLabel,
		type Provider
	} from '$lib/llm';

	// Cohort Parquet base. Defaults to the bundled MVP fixture under
	// /demo-data; override at build time with
	//   VITE_DEMO_DATA_BASE=https://demo-data.vcfclick.io/1kg-chr21
	//
	// Built at onMount time (browser-only) so we can prepend the
	// page origin. DuckDB-Wasm's read_parquet() needs an absolute
	// https:// URL — a path-only string like `/vcfclick-demo/demo-data/...`
	// is passed straight to httpfs, which fails to resolve it.
	function resolveDataBase(): string {
		const configured = import.meta.env.VITE_DEMO_DATA_BASE as string | undefined;
		if (configured) return configured;
		// `base` is the SvelteKit configured base path (e.g. /vcfclick-demo).
		// window.origin is e.g. https://nuin.github.io.
		return `${window.location.origin}${base}/demo-data`;
	}

	const SAMPLE_QUESTIONS = [
		'Which variants have the highest allele frequency in this cohort?',
		'How many variants are in this cohort?',
		'How many samples are in the cohort?',
		'Show the top 10 variants by allele frequency between chr21:18M and 20M.'
	];

	const STATS = [
		['2,504', 'samples'],
		['~243k', 'variants'],
		['DuckDB-Wasm', 'browser demo'],
		['chDB', 'ClickHouse backend']
	];

	let dbReady = $state(false);
	let dbError = $state<string | null>(null);
	let loadLabel = $state('Starting…');
	let loadFraction = $state<number | null>(null);
	let question = $state('');
	let asking = $state(false);
	let sql = $state<string | null>(null);
	let explanation = $state<string | null>(null);
	let modelLabel = $state<string | null>(null);
	let resultColumns = $state<string[]>([]);
	let resultRows = $state<unknown[][]>([]);
	let queryMs = $state(0);
	let resultTruncated = $state(false);
	let errorMsg = $state<string | null>(null);

	// Settings drawer state. Each provider keeps its own key + model in
	// localStorage, so switching providers swaps the visible drafts
	// rather than clobbering the other provider's stored key.
	let settingsOpen = $state(false);
	let provider = $state<Provider>('google');
	let keyDraft = $state('');
	let modelDraft = $state('');
	let hasKey = $state(false);

	onMount(async () => {
		provider = getProvider();
		loadProviderDrafts(provider);
		try {
			await registerCohort(resolveDataBase(), (p: LoadProgress) => {
				loadLabel = p.label;
				loadFraction = p.fraction;
			});
			dbReady = true;
		} catch (e) {
			dbError = (e as Error).message;
		}
	});

	function loadProviderDrafts(p: Provider) {
		keyDraft = getKey(p);
		modelDraft = getModel(p);
		hasKey = !!keyDraft;
	}

	// User flips the provider radio in the drawer — persist the choice
	// and reload that provider's saved key/model into the fields.
	function selectProvider(p: Provider) {
		provider = p;
		setProvider(p);
		loadProviderDrafts(p);
	}

	function saveSettings() {
		setKey(provider, keyDraft.trim());
		setModel(provider, modelDraft.trim());
		hasKey = !!keyDraft.trim();
		settingsOpen = false;
	}

	function clearKey() {
		setKey(provider, '');
		keyDraft = '';
		hasKey = false;
	}

	async function ask() {
		if (!question.trim()) return;
		if (!hasKey) {
			settingsOpen = true;
			return;
		}
		asking = true;
		errorMsg = null;
		sql = null;
		explanation = null;
		resultColumns = [];
		resultRows = [];
		resultTruncated = false;
		try {
			const completion = await complete(question);
			sql = completion.sql;
			explanation = completion.explanation;
			modelLabel = completion.model;

			const r = await query(completion.sql);
			resultColumns = r.columns;
			resultRows = r.rows;
			queryMs = r.ms;
			resultTruncated = r.truncated;
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			asking = false;
		}
	}

	function setSample(q: string) {
		question = q;
	}
</script>

<svelte:head>
	<title>vcfclick demo — ask in English, see the SQL</title>
</svelte:head>

<main class="mx-auto max-w-4xl px-4 py-12">
	<header class="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row">
		<div class="max-w-2xl">
			<p class="mb-2 text-xs font-bold tracking-wide text-[var(--color-primary)] uppercase">
				vcfclick hosted preview
			</p>
			<h1 class="mb-2 text-3xl font-bold text-gray-900">
				Explore a VCF cohort without downloading the VCF
			</h1>
			<p class="max-w-2xl text-gray-600">
				Ask a genomics question, inspect the generated SQL, and query a 1000
				Genomes phase 3 cohort directly in your browser. This public demo uses
				DuckDB-Wasm over Parquet; vcfclick also supports embedded chDB for
				ClickHouse-backed cohort databases with no ClickHouse server to operate.
			</p>
			<p class="mt-3 text-sm text-gray-500">
				Source:
				<a
					href="https://github.com/nuin/vcfclick"
					class="text-[var(--color-primary)] hover:underline"
					target="_blank"
					rel="noopener noreferrer">github.com/nuin/vcfclick</a
				>
				·
				<a
					href="https://pypi.org/project/vcfclick/"
					class="text-[var(--color-primary)] hover:underline"
					target="_blank"
					rel="noopener noreferrer">PyPI</a
				>
			</p>
			<div class="mt-5 flex flex-wrap gap-2">
				{#each STATS as [value, label]}
					<div class="rounded border border-stone-200 bg-white px-3 py-2 shadow-sm">
						<div class="font-mono text-sm font-bold text-gray-900">{value}</div>
						<div class="text-xs text-gray-500">{label}</div>
					</div>
				{/each}
			</div>
		</div>
		<button
			type="button"
			onclick={() => (settingsOpen = !settingsOpen)}
			class="shrink-0 whitespace-nowrap rounded border border-stone-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
			title="API key settings"
		>
			{hasKey ? '⚙ settings' : '⚙ set API key'}
		</button>
	</header>

	{#if settingsOpen}
		<section class="mb-6 rounded border border-stone-300 bg-white p-5 text-sm shadow-sm">
			<h2 class="mb-3 font-medium text-gray-800">API key</h2>

			<!-- Provider picker. Google Gemini is the free-tier default so
			     visitors without a paid Anthropic balance can still try the
			     demo: an AI Studio key needs only a Google account. -->
			<fieldset class="mb-4">
				<legend class="mb-2 text-xs font-medium text-gray-700">Provider</legend>
				<div class="flex flex-col gap-2 sm:flex-row sm:gap-4">
					<label class="flex items-center gap-2">
						<input
							type="radio"
							name="provider"
							value="google"
							checked={provider === 'google'}
							onchange={() => selectProvider('google')}
						/>
						<span>Google Gemini <span class="text-green-700">(free)</span></span>
					</label>
					<label class="flex items-center gap-2">
						<input
							type="radio"
							name="provider"
							value="anthropic"
							checked={provider === 'anthropic'}
							onchange={() => selectProvider('anthropic')}
						/>
						<span>Anthropic Claude <span class="text-gray-400">(paid)</span></span>
					</label>
				</div>
			</fieldset>

			<p class="mb-3 text-gray-600">
				The page calls
				<strong>{getProviderLabel(provider)}</strong>
				directly from your browser; your key stays in your browser's localStorage and
				is never sent anywhere except the provider's own API endpoint.
				{#if provider === 'google'}
					Gemini's free tier needs only a Google account — no payment method.
				{/if}
			</p>

			<label class="mb-1 block text-xs font-medium text-gray-700" for="key">API key</label>
			<input
				id="key"
				type="password"
				bind:value={keyDraft}
				placeholder={provider === 'google' ? 'AIza…' : 'sk-ant-…'}
				class="mb-3 w-full rounded border border-stone-300 p-2 font-mono text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
			/>
			<label class="mb-1 block text-xs font-medium text-gray-700" for="model"
				>Model (optional)</label
			>
			<input
				id="model"
				type="text"
				bind:value={modelDraft}
				placeholder={provider === 'google' ? 'gemini-flash-latest' : 'claude-haiku-4-5-20251001'}
				class="mb-4 w-full rounded border border-stone-300 p-2 font-mono text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
			/>
			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={saveSettings}
					class="rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
					>save</button
				>
				{#if hasKey}
					<button
						type="button"
						onclick={clearKey}
						class="text-xs text-gray-500 hover:text-red-700">clear key</button
					>
				{/if}
				<a
					href={getKeyDocsUrl(provider)}
					target="_blank"
					rel="noopener noreferrer"
					class="ml-auto text-xs text-[var(--color-primary)] hover:underline">get a key →</a
				>
			</div>
		</section>
	{/if}

	{#if dbError}
		<div class="mb-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900">
			<strong>Couldn't load the cohort.</strong> {dbError}
		</div>
	{:else if !dbReady}
		<div class="mb-6 rounded border border-stone-200 bg-white p-4 text-sm text-gray-600">
			<div class="mb-2 flex items-center justify-between">
				<span>{loadLabel}</span>
				{#if loadFraction !== null}
					<span class="font-mono text-xs text-gray-400"
						>{Math.round(loadFraction * 100)}%</span
					>
				{/if}
			</div>
			<div class="h-1.5 w-full overflow-hidden rounded bg-stone-100">
				{#if loadFraction !== null}
					<!-- Determinate: width tracks the real byte / table fraction. -->
					<div
						class="h-full rounded bg-[var(--color-primary)] transition-[width] duration-200"
						style="width: {Math.round(loadFraction * 100)}%"
					></div>
				{:else}
					<!-- Indeterminate: a sliding sliver while the total is unknown
					     (e.g. engine served from browser cache with no byte total). -->
					<div class="h-full w-1/3 animate-pulse rounded bg-[var(--color-primary)]"></div>
				{/if}
			</div>
		</div>
	{/if}

	<section class="mb-6">
		<label for="question" class="mb-2 block text-sm font-medium text-gray-700"
			>Your question</label
		>
		<textarea
			id="question"
			bind:value={question}
			rows="3"
			placeholder="e.g. Which variants have the highest allele frequency in this cohort?"
			class="w-full rounded border border-stone-300 bg-white p-3 font-mono text-sm shadow-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
		></textarea>
		<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
			<span class="mr-1">try:</span>
			{#each SAMPLE_QUESTIONS as q}
				<button
					type="button"
					onclick={() => setSample(q)}
					class="rounded border border-stone-200 bg-stone-50 px-2 py-1 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
					>{q.replace(/\?$/, '')}</button
				>
			{/each}
		</div>
		<button
			type="button"
			onclick={ask}
			disabled={!dbReady || asking || !question.trim()}
			class="mt-4 inline-flex items-center gap-2 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-stone-300"
		>
			{asking ? 'asking…' : 'ask'}
		</button>
	</section>

	{#if errorMsg}
		<div class="mb-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900">
			{errorMsg}
		</div>
	{/if}

	{#if sql}
		<section class="mb-6">
			<h2 class="mb-2 flex items-baseline justify-between text-sm font-medium text-gray-700">
				<span>SQL the model wrote</span>
				{#if modelLabel}
					<span class="font-mono text-xs text-gray-400">{modelLabel}</span>
				{/if}
			</h2>
			<pre
				class="overflow-x-auto rounded bg-gray-900 p-4 text-sm leading-relaxed text-stone-100"><code
					>{sql}</code
				></pre>
			{#if explanation}
				<p class="mt-2 text-sm leading-relaxed text-gray-600">{explanation}</p>
			{/if}
		</section>

		<section>
			<h2 class="mb-2 flex items-baseline justify-between text-sm font-medium text-gray-700">
				<span>Results</span>
				<span class="font-mono text-xs text-gray-400"
					>{resultTruncated ? `first ${resultRows.length}` : resultRows.length} rows ·
					{queryMs.toFixed(0)} ms</span
				>
			</h2>
			{#if resultTruncated}
				<p
					class="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
				>
					Showing the first {resultRows.length} rows. The demo caps results to keep the
					browser responsive — add a tighter <code>WHERE</code> or
					<code>LIMIT</code> to your question to narrow it down.
				</p>
			{/if}
			{#if resultRows.length === 0}
				<p class="rounded border border-stone-200 bg-white p-4 text-sm text-gray-500">
					Query returned no rows.
				</p>
			{:else}
				<div class="overflow-x-auto rounded border border-stone-200 bg-white">
					<table class="min-w-full divide-y divide-stone-200 text-sm">
						<thead class="bg-stone-50">
							<tr>
								{#each resultColumns as col}
									<th
										class="px-3 py-2 text-left font-mono text-xs font-medium tracking-wide text-gray-600 uppercase"
										>{col}</th
									>
								{/each}
							</tr>
						</thead>
						<tbody class="divide-y divide-stone-100">
							{#each resultRows as row}
								<tr>
									{#each row as cell}
										<td class="px-3 py-2 font-mono text-xs text-gray-800"
											>{cell === null || cell === undefined ? '—' : String(cell)}</td
										>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}

	<section class="mt-8 rounded border border-stone-300 bg-white p-5 shadow-sm">
		<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<p class="mb-1 text-xs font-bold tracking-wide text-[var(--color-primary)] uppercase">
					Hosted workspaces
				</p>
				<h2 class="text-sm font-bold text-gray-900">Want this for your cohort?</h2>
			</div>
			<a
				href="https://github.com/nuin/vcfclick/issues/new?title=Hosted%20cohort%20workspace"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
				>Request hosted cohort workspace</a
			>
		</div>
		<p class="mb-4 max-w-2xl text-sm leading-relaxed text-gray-600">
			Hosted vcfclick workspaces turn VCF-derived cohorts into private, shareable
			query surfaces. Use DuckDB/Parquet for lightweight browser sharing and
			chDB-backed workspaces when cohort-scale genotype queries need
			ClickHouse-style performance.
		</p>
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="rounded border border-stone-200 bg-stone-50 p-4">
				<h3 class="mb-2 text-sm font-bold text-gray-900">For labs</h3>
				<ul class="space-y-1 text-sm text-gray-600">
					<li>Private cohort workspace for PI and lab members</li>
					<li>Saved SQL, visible generated queries, CSV/Parquet export</li>
					<li>Local-first CLI path when data cannot leave the workstation</li>
				</ul>
			</div>
			<div class="rounded border border-stone-200 bg-stone-50 p-4">
				<h3 class="mb-2 text-sm font-bold text-gray-900">For cores</h3>
				<ul class="space-y-1 text-sm text-gray-600">
					<li>Project workspaces instead of static TSV handoffs</li>
					<li>Shareable collaborator access with auditable SQL</li>
					<li>Bundle import/export for repeatable delivery workflows</li>
				</ul>
			</div>
		</div>
	</section>

	<footer class="mt-16 border-t border-stone-200 pt-6 text-sm text-gray-500">
		<p>
			Runs DuckDB-Wasm in your browser. You bring your own API key for either Google
			Gemini (free tier) or Anthropic Claude — it stays in your browser's localStorage
			and is only ever sent to that provider's own API endpoint. Parquet files are
			fetched by HTTP range read, so you only download the columns and row groups
			each query touches. The full vcfclick CLI can also use embedded chDB, giving
			labs and cores a ClickHouse-compatible backend without operating a ClickHouse
			server.
		</p>
	</footer>
</main>
