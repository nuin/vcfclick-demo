// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { SCHEMA_BRIEFING } from './schema-briefing';

describe('SCHEMA_BRIEFING', () => {
	test('steers broad allele-frequency ranking to variants.info_AF', () => {
		expect(SCHEMA_BRIEFING).toContain('Use variants.info_AF');
		expect(SCHEMA_BRIEFING).toContain('Do not aggregate the full genotypes table');
	});
});
