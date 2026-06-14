// Public re-exports for the demo's lib/ surface.
export { getDuckDB, registerCohort, query, MAX_RESULT_ROWS } from './duckdb';
export type { LoadProgress, QueryResult } from './duckdb';
export { SCHEMA_BRIEFING } from './schema-briefing';
export {
	complete,
	getProvider,
	setProvider,
	getKey,
	setKey,
	getModel,
	setModel,
	getKeyDocsUrl,
	getProviderLabel
} from './llm';
export type { CompletionResult, Provider } from './llm';
