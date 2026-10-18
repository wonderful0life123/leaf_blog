// Shared by the navbar and full search page; no request until the first query.
export function createSearchClient(load) {
	let ready;
	return async (query, limit = Number.POSITIVE_INFINITY) => {
		if (!query.trim()) return { results: [], total: 0 };
		if (!ready) {
			ready = Promise.resolve()
				.then(load)
				.then(async (api) => {
					await api.options({ excerptLength: 20 });
					return api;
				})
				.catch((error) => {
					ready = undefined;
					throw error;
				});
		}
		const api = await ready;
		const response = await api.search(query);
		const results = await Promise.all(
			response.results.slice(0, limit).map((item) => item.data()),
		);
		return { results, total: response.results.length };
	};
}

const scriptUrl = `${(import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/")}pagefind/pagefind.js`;
export const searchArticles = createSearchClient(
	() => import(/* @vite-ignore */ scriptUrl),
);
