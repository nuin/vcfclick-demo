// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { validateDemoSql } from './duckdb';

describe('validateDemoSql', () => {
	test('rejects broad genotype aggregation that can exhaust browser memory', () => {
		expect(() =>
			validateDemoSql(`
				WITH cohort_size AS (
					SELECT 2 * count(DISTINCT (ingest_id, sample_id)) AS an
					FROM samples
				)
				SELECT g.chrom, g.pos, g.ref, g.alt, sum(g.gt) AS ac
				FROM genotypes g
				CROSS JOIN cohort_size
				GROUP BY g.chrom, g.pos, g.ref, g.alt
				ORDER BY ac DESC
				LIMIT 20
			`)
		).toThrow(/too much browser memory/);
	});

	test('allows region-limited genotype aggregation', () => {
		expect(() =>
			validateDemoSql(`
				SELECT chrom, pos, ref, alt, sum(gt) AS ac
				FROM genotypes
				WHERE chrom = 'chr21' AND pos BETWEEN 18000000 AND 20000000
				GROUP BY chrom, pos, ref, alt
				ORDER BY ac DESC
				LIMIT 20
			`)
		).not.toThrow();
	});

	test('allows variants-only allele frequency ranking', () => {
		expect(() =>
			validateDemoSql(`
				SELECT chrom, pos, ref, alt, info_AF
				FROM variants
				ORDER BY info_AF DESC
				LIMIT 20
			`)
		).not.toThrow();
	});
});
