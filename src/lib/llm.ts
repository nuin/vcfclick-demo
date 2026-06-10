/**
 * Browser-direct Anthropic Messages call.
 *
 * The demo runs as fully-static GH Pages content with no server,
 * so the user supplies their own Anthropic API key. The key lives
 * in localStorage on the visitor's device. The Anthropic API
 * accepts browser-origin requests when the explicit opt-in header
 * `anthropic-dangerous-direct-browser-access: true` is set — that
 * header exists for exactly this use case (developer-bring-your-
 * own-key static demos).
 *
 * We never POST the key anywhere except api.anthropic.com.
 */

import { SCHEMA_BRIEFING } from './schema-briefing';

const STORAGE_KEY = 'vcfclick-demo:anthropic-key';
const STORAGE_MODEL = 'vcfclick-demo:anthropic-model';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_QUESTION_LEN = 1000;

export function getKey(): string {
	if (typeof localStorage === 'undefined') return '';
	return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function setKey(v: string): void {
	if (typeof localStorage === 'undefined') return;
	if (v) localStorage.setItem(STORAGE_KEY, v);
	else localStorage.removeItem(STORAGE_KEY);
}

export function getModel(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_MODEL;
	return localStorage.getItem(STORAGE_MODEL) ?? DEFAULT_MODEL;
}

export function setModel(v: string): void {
	if (typeof localStorage === 'undefined') return;
	if (v && v !== DEFAULT_MODEL) localStorage.setItem(STORAGE_MODEL, v);
	else localStorage.removeItem(STORAGE_MODEL);
}

interface AnthropicResponse {
	content?: Array<{ type: string; text?: string }>;
	error?: { message?: string; type?: string };
}

export interface CompletionResult {
	sql: string;
	explanation: string;
	model: string;
}

const SYSTEM_PROMPT =
	SCHEMA_BRIEFING +
	'\n\nReturn ONLY a JSON object with two keys: ' +
	'`sql` (the SQL statement to run against the cohort tables) and ' +
	'`explanation` (one paragraph describing why this SQL answers the ' +
	"user's question, mentioning the cohort-size CTE if allele " +
	'frequency is involved). Do not wrap in markdown code fences.';

export async function complete(question: string): Promise<CompletionResult> {
	const trimmed = question.trim();
	if (!trimmed) throw new Error('question is empty');
	if (trimmed.length > MAX_QUESTION_LEN) {
		throw new Error(`question too long (limit ${MAX_QUESTION_LEN} chars)`);
	}

	const key = getKey();
	if (!key) {
		throw new Error('Anthropic API key not set. Click the settings icon to add one.');
	}

	const model = getModel();
	const upstream = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': key,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true'
		},
		body: JSON.stringify({
			model,
			max_tokens: 700,
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: trimmed }]
		})
	});

	if (!upstream.ok) {
		const text = await upstream.text();
		// Surface 401 specifically — most common failure mode here.
		if (upstream.status === 401) {
			throw new Error('Anthropic rejected the API key. Check it in settings.');
		}
		throw new Error(`Anthropic ${upstream.status}: ${text.slice(0, 300)}`);
	}

	const data = (await upstream.json()) as AnthropicResponse;
	const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
	if (!text) throw new Error('empty response from model');

	const cleaned = text
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```\s*$/i, '')
		.trim();

	let parsed: { sql?: string; explanation?: string };
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		throw new Error('model did not return valid JSON');
	}
	if (!parsed.sql) throw new Error('model omitted `sql` field');

	return {
		sql: parsed.sql,
		explanation: parsed.explanation ?? '',
		model
	};
}
