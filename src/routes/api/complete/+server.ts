/**
 * Anthropic API proxy.
 *
 * The page never sees the API key. It POSTs a natural-language
 * question here; this handler prepends the cohort schema briefing,
 * calls the Anthropic Messages API, and returns the model's
 * suggested SQL + a one-paragraph explanation.
 *
 * Required Cloudflare Pages env vars:
 *   ANTHROPIC_API_KEY     — secret, never exposed to the client
 *   ANTHROPIC_MODEL       — defaults to claude-haiku-4-5-20251001
 *
 * Rate limiting in MVP form: per-IP throttle via the platform's
 * Rate Limiting API. Replace with a paid Worker binding for
 * production traffic.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { SCHEMA_BRIEFING } from '$lib/schema-briefing';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_QUESTION_LEN = 1000;

interface CompletePayload {
	question?: string;
}

interface AnthropicResponse {
	content?: Array<{ type: string; text?: string }>;
	error?: { message?: string };
}

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const apiKey = platform?.env?.ANTHROPIC_API_KEY;
	if (!apiKey) {
		return json(
			{
				error:
					'ANTHROPIC_API_KEY not configured on the server. ' +
					'See packaging/README.md for setup.'
			},
			{ status: 503 }
		);
	}

	let body: CompletePayload;
	try {
		body = (await request.json()) as CompletePayload;
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}

	const question = (body.question ?? '').toString().trim();
	if (!question) {
		return json({ error: 'question is required' }, { status: 400 });
	}
	if (question.length > MAX_QUESTION_LEN) {
		return json(
			{ error: `question too long (limit ${MAX_QUESTION_LEN} chars)` },
			{ status: 413 }
		);
	}

	// Client-IP for rate limiting / abuse tracking. Cloudflare-routed
	// requests carry a real IP; local dev returns ::1.
	const ip = getClientAddress();

	const systemPrompt =
		SCHEMA_BRIEFING +
		'\n\nReturn ONLY a JSON object with two keys: ' +
		'`sql` (the SQL statement to run against the cohort tables) and ' +
		'`explanation` (one paragraph describing why this SQL answers the ' +
		'user\'s question, mentioning the cohort-size CTE if allele ' +
		'frequency is involved). Do not wrap in markdown code fences.';

	const model = platform?.env?.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

	const upstream = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01'
		},
		body: JSON.stringify({
			model,
			max_tokens: 700,
			system: systemPrompt,
			messages: [{ role: 'user', content: question }]
		})
	});

	if (!upstream.ok) {
		const text = await upstream.text();
		return json(
			{ error: `upstream Anthropic error (${upstream.status}): ${text.slice(0, 500)}` },
			{ status: 502 }
		);
	}

	const data = (await upstream.json()) as AnthropicResponse;
	const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
	if (!text) {
		return json({ error: 'empty response from model', raw: data }, { status: 502 });
	}

	// Parse the JSON the model returned. Be lenient with stray code
	// fences in case the model ignores the instruction.
	const cleaned = text
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```\s*$/i, '')
		.trim();
	let payload: { sql?: string; explanation?: string };
	try {
		payload = JSON.parse(cleaned);
	} catch {
		return json(
			{ error: 'model did not return valid JSON', raw: text },
			{ status: 502 }
		);
	}

	if (!payload.sql) {
		return json({ error: 'model omitted `sql` field', raw: text }, { status: 502 });
	}

	return json({
		sql: payload.sql,
		explanation: payload.explanation ?? '',
		model,
		ip_hash: hashIp(ip)
	});
};

/** Short non-reversible IP hint for log correlation; not for tracking. */
function hashIp(ip: string): string {
	let h = 0;
	for (let i = 0; i < ip.length; i++) {
		h = (h * 31 + ip.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(16).slice(0, 8);
}
