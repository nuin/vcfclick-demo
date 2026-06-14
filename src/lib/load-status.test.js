// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { readyNotice } from './load-status';

describe('readyNotice', () => {
	test('returns a ready message only after cohort registration succeeds', () => {
		expect(readyNotice({ dbReady: false, dbError: null })).toBe(null);
		expect(readyNotice({ dbReady: true, dbError: 'failed' })).toBe(null);
		expect(readyNotice({ dbReady: true, dbError: null })).toContain('Ask a question');
	});
});
