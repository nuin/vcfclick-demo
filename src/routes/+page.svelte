<script lang="ts">
	import { onMount } from 'svelte';
	import { query, registerCohort } from '$lib/duckdb';

	// Configured at build time. For local dev the demo-data/ files
	// are served from /static; for production swap to the R2 base URL.
	const DATA_BASE: string = (import.meta.env.VITE_DEMO_DATA_BASE as string) ?? '/demo-data';

	const SAMPLE_QUESTIONS = [
		'Which variants have the highest allele frequency in this cohort?',
		'How many variants are on chromosome 21?',
		'How many samples are in the cohort?',
		"What's the average DP across all variant calls?"
	];

	let dbReady = $state(false);
	let dbError = $state<string | null>(null);
	let question = $state('');
	let asking = $state(false);
	let sql = $state<string | null>(null);
	let explanation = $state<string | null>(null);
	let resultColumns = $state<string[]>([]);
	let resultRows = $state<unknown[][]>([]);
	let queryMs = $state(0);
	let modelLabel = $state<string | null>(null);
	let errorMsg = $state<string | null>(null);

	onMount(async () => {
		try {
			await registerCohort(DATA_BASE);
			dbReady = true;
		} catch (e) {
			dbError = (e as Error).message;
		}
	});

	async function ask() {
		if (!question.trim()) return;
		asking = true;
		errorMsg = null;
		sql = null;
		explanation = null;
		resultColumns = [];
		resultRows = [];
		try {
			const completion = await fetch('/api/complete', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question })
			});
			if (!completion.ok) {
				const e = (await completion.json()) as { error?: string };
				throw new Error(e.error ?? `HTTP ${completion.status}`);
			}
			const data = (await completion.json()) as {
				sql: string;
				explanation: string;
				model: string;
			};
			sql = data.sql;
			explanation = data.explanation;
			modelLabel = data.model;

			const r = await query(data.sql);
			resultColumns = r.columns;
			resultRows = r.rows;
			queryMs = r.ms;
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
	<header class="mb-10">
		<h1 class="mb-2 text-3xl font-bold text-gray-900">vcfclick demo</h1>
		<p class="max-w-2xl text-gray-600">
			Ask a population-genetics question in English. A language model writes the SQL;
			DuckDB-Wasm runs it in your browser against a 1000 Genomes chr21 cohort. You see
			the SQL it wrote, so you can audit the math.
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
	</header>

	{#if dbError}
		<div class="mb-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900">
			<strong>Couldn't load the cohort.</strong> {dbError}
		</div>
	{:else if !dbReady}
		<div class="mb-6 rounded border border-stone-200 bg-white p-4 text-sm text-gray-600">
			Loading DuckDB-Wasm and connecting to the cohort…
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
					>{resultRows.length} rows · {queryMs.toFixed(0)} ms</span
				>
			</h2>
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

	<footer class="mt-16 border-t border-stone-200 pt-6 text-sm text-gray-500">
		<p>
			Runs DuckDB-Wasm in your browser; only the natural-language question is sent
			to a server (a Cloudflare Pages Function that proxies the Anthropic API).
			Parquet files are fetched by HTTP range read, so you only download the columns
			and row groups each query touches.
		</p>
	</footer>
</main>
