/**
 * Browser-direct LLM calls.
 *
 * The demo runs as fully-static GH Pages content with no server, so
 * the user supplies their own API key for a provider of their choice.
 * Keys live in localStorage and are only ever sent to the provider's
 * own API endpoint.
 *
 * Two providers are supported:
 *
 *   * `anthropic` — Claude Messages API. Requires a funded balance
 *     (smallest top-up: ~$5). Best SQL quality at the haiku tier.
 *     Uses the `anthropic-dangerous-direct-browser-access: true`
 *     opt-in header that Anthropic ships for static-demo use cases.
 *
 *   * `google` — Gemini Generative Language API. **Free tier**, no
 *     payment method required: just a Google account → AI Studio key.
 *     1500 requests/day on Gemini 2.0 Flash is plenty for a demo.
 *     Browser-direct calls are CORS-supported.
 *
 * Both paths use the same schema briefing and the same {sql,
 * explanation} JSON contract so the page UI doesn't care which
 * provider answered.
 */

import { SCHEMA_BRIEFING } from './schema-briefing';

export type Provider = 'anthropic' | 'google';

const STORAGE_PROVIDER = 'vcfclick-demo:provider';
const STORAGE_KEY = {
	anthropic: 'vcfclick-demo:anthropic-key',
	google: 'vcfclick-demo:google-key'
} as const;
const STORAGE_MODEL = {
	anthropic: 'vcfclick-demo:anthropic-model',
	google: 'vcfclick-demo:google-model'
} as const;

const DEFAULT_MODEL = {
	anthropic: 'claude-haiku-4-5-20251001',
	google: 'gemini-2.0-flash'
} as const;

const KEY_DOCS = {
	anthropic: 'https://console.anthropic.com/settings/keys',
	google: 'https://aistudio.google.com/apikey'
} as const;

const PROVIDER_LABEL = {
	anthropic: 'Anthropic Claude',
	google: 'Google Gemini (free tier)'
} as const;

const MAX_QUESTION_LEN = 1000;

export function getProvider(): Provider {
	if (typeof localStorage === 'undefined') return 'google';
	const v = localStorage.getItem(STORAGE_PROVIDER);
	return v === 'anthropic' ? 'anthropic' : 'google';
}

export function setProvider(v: Provider): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_PROVIDER, v);
}

export function getKey(provider: Provider = getProvider()): string {
	if (typeof localStorage === 'undefined') return '';
	return localStorage.getItem(STORAGE_KEY[provider]) ?? '';
}

export function setKey(provider: Provider, v: string): void {
	if (typeof localStorage === 'undefined') return;
	if (v) localStorage.setItem(STORAGE_KEY[provider], v);
	else localStorage.removeItem(STORAGE_KEY[provider]);
}

export function getModel(provider: Provider = getProvider()): string {
	if (typeof localStorage === 'undefined') return DEFAULT_MODEL[provider];
	return localStorage.getItem(STORAGE_MODEL[provider]) ?? DEFAULT_MODEL[provider];
}

export function setModel(provider: Provider, v: string): void {
	if (typeof localStorage === 'undefined') return;
	if (v && v !== DEFAULT_MODEL[provider])
		localStorage.setItem(STORAGE_MODEL[provider], v);
	else localStorage.removeItem(STORAGE_MODEL[provider]);
}

export function getKeyDocsUrl(provider: Provider): string {
	return KEY_DOCS[provider];
}

export function getProviderLabel(provider: Provider): string {
	return PROVIDER_LABEL[provider];
}

export interface CompletionResult {
	sql: string;
	explanation: string;
	model: string;
	provider: Provider;
}

const SYSTEM_PROMPT =
	SCHEMA_BRIEFING +
	'\n\nReturn ONLY a JSON object with two keys: ' +
	'`sql` (the SQL statement to run against the cohort tables) and ' +
	'`explanation` (one paragraph describing why this SQL answers the ' +
	"user's question, mentioning the cohort-size CTE if allele " +
	'frequency is involved). Do not wrap in markdown code fences.';

interface ParsedCompletion {
	sql?: string;
	explanation?: string;
}

function parseJsonCompletion(text: string): ParsedCompletion {
	const cleaned = text
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```\s*$/i, '')
		.trim();
	try {
		return JSON.parse(cleaned);
	} catch {
		throw new Error('model did not return valid JSON');
	}
}

interface AnthropicResponse {
	content?: Array<{ type: string; text?: string }>;
	error?: { message?: string; type?: string };
}

async function completeAnthropic(
	question: string,
	key: string,
	model: string
): Promise<CompletionResult> {
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
			messages: [{ role: 'user', content: question }]
		})
	});

	if (!upstream.ok) {
		const text = await upstream.text();
		if (upstream.status === 401) {
			throw new Error('Anthropic rejected the API key. Check it in settings.');
		}
		throw new Error(`Anthropic ${upstream.status}: ${text.slice(0, 300)}`);
	}

	const data = (await upstream.json()) as AnthropicResponse;
	const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
	if (!text) throw new Error('empty response from Anthropic');

	const parsed = parseJsonCompletion(text);
	if (!parsed.sql) throw new Error('Anthropic response omitted `sql` field');

	return {
		sql: parsed.sql,
		explanation: parsed.explanation ?? '',
		model,
		provider: 'anthropic'
	};
}

interface GeminiResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
	}>;
	error?: { message?: string; code?: number };
}

async function completeGoogle(
	question: string,
	key: string,
	model: string
): Promise<CompletionResult> {
	// Gemini supports structured JSON output via responseSchema, so we
	// ask for `{sql, explanation}` natively instead of relying on the
	// model following a "return JSON only" instruction in the prompt.
	const url =
		`https://generativelanguage.googleapis.com/v1beta/models/` +
		`${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

	const upstream = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
			contents: [{ role: 'user', parts: [{ text: question }] }],
			generationConfig: {
				maxOutputTokens: 700,
				responseMimeType: 'application/json',
				responseSchema: {
					type: 'object',
					properties: {
						sql: { type: 'string' },
						explanation: { type: 'string' }
					},
					required: ['sql']
				}
			}
		})
	});

	if (!upstream.ok) {
		const text = await upstream.text();
		if (upstream.status === 400 && text.toLowerCase().includes('api key')) {
			throw new Error('Google rejected the API key. Check it in settings.');
		}
		if (upstream.status === 429) {
			throw new Error(
				'Google free-tier rate limit hit. Wait a minute or switch to ' +
					'Anthropic in settings.'
			);
		}
		throw new Error(`Gemini ${upstream.status}: ${text.slice(0, 300)}`);
	}

	const data = (await upstream.json()) as GeminiResponse;
	const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
	if (!text) throw new Error('empty response from Gemini');

	const parsed = parseJsonCompletion(text);
	if (!parsed.sql) throw new Error('Gemini response omitted `sql` field');

	return {
		sql: parsed.sql,
		explanation: parsed.explanation ?? '',
		model,
		provider: 'google'
	};
}

export async function complete(question: string): Promise<CompletionResult> {
	const trimmed = question.trim();
	if (!trimmed) throw new Error('question is empty');
	if (trimmed.length > MAX_QUESTION_LEN) {
		throw new Error(`question too long (limit ${MAX_QUESTION_LEN} chars)`);
	}

	const provider = getProvider();
	const key = getKey(provider);
	if (!key) {
		throw new Error(
			`${PROVIDER_LABEL[provider]} API key not set. Click the settings icon to add one.`
		);
	}

	const model = getModel(provider);
	if (provider === 'anthropic') return completeAnthropic(trimmed, key, model);
	return completeGoogle(trimmed, key, model);
}
