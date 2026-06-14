interface ReadyNoticeState {
	dbReady: boolean;
	dbError: string | null;
}

export function readyNotice({ dbReady, dbError }: ReadyNoticeState): string | null {
	if (!dbReady || dbError) return null;
	return 'Ask a question to generate SQL and run it in your browser.';
}
