import { githubCardHtml, githubRepo } from "../../lib/github-card.mjs";

export { githubCardHtml };
export function githubDirective(line) {
	const match =
		/^ {0,3}::github\{\s*repo\s*=\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s}"']+))\s*\}[ \t]*$/.exec(
			line,
		);
	return match ? githubRepo(match[1] || match[2] || match[3]) : null;
}
export const githubExtension = {
	name: "githubCard",
	level: "block",
	start(src) {
		const match = /\n {0,3}::github\{/.exec(src);
		return match ? match.index + 1 : undefined;
	},
	tokenizer(src) {
		const raw = src.split("\n", 1)[0];
		const repo = githubDirective(raw);
		if (repo)
			return {
				type: "githubCard",
				raw: raw + (src[raw.length] === "\n" ? "\n" : ""),
				repo,
			};
	},
	renderer(token) {
		return `${githubCardHtml(token.repo)}\n`;
	},
};

export function createGithubLoader(
	fetcher = (...args) => fetch(...args),
	now = Date.now,
) {
	const cache = new Map();
	return (repo) => {
		if (!githubRepo(repo)) return Promise.resolve(null);
		const key = repo.toLowerCase();
		const old = cache.get(key);
		if (old && old.expires > now()) return old.promise;
		const entry = { expires: now() + 300_000 };
		entry.promise = Promise.resolve()
			.then(() =>
				fetcher(`https://api.github.com/repos/${repo}`, {
					credentials: "omit",
					referrerPolicy: "no-referrer",
					signal: AbortSignal.timeout(8000),
				}),
			)
			.then((response) => {
				if (!response.ok) throw Error("Repository unavailable");
				return response.json();
			})
			.then((data) => ({
				description:
					typeof data.description === "string" ? data.description : "",
				stars: Number.isFinite(data.stargazers_count)
					? data.stargazers_count
					: null,
				forks: Number.isFinite(data.forks_count) ? data.forks_count : null,
				license:
					typeof data.license?.spdx_id === "string"
						? data.license.spdx_id
						: "—",
				language: typeof data.language === "string" ? data.language : "",
			}))
			.catch(() => {
				entry.expires = now() + 30_000;
				return null;
			});
		if (cache.size >= 64) cache.delete(cache.keys().next().value);
		cache.set(key, entry);
		return entry.promise;
	};
}
const load = createGithubLoader();
export function hydrateGithubCard(card, onLayout = () => {}) {
	const repo = githubRepo(
		(card.getAttribute("href") || "").replace(/^https:\/\/github\.com\//, ""),
	);
	if (!repo) return;
	load(repo).then((info) => {
		if (!card.isConnected) return;
		const description = card.querySelector(".gc-description");
		if (description)
			description.textContent = info
				? info.description || "这个仓库还没有填写简介。"
				: "暂时无法获取仓库信息 · 仍可打开 GitHub";
		if (info)
			for (const [selector, value] of [
				[".gc-stars", info.stars?.toLocaleString() || "—"],
				[".gc-forks", info.forks?.toLocaleString() || "—"],
				[".gc-license", info.license],
				[".gc-language", info.language],
			]) {
				const field = card.querySelector(selector);
				if (field) field.textContent = value;
			}
		onLayout();
	});
}
export function githubCards(node) {
	let observer;
	let frame;
	function scan() {
		observer?.disconnect();
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const cards = node.querySelectorAll("a.card-github");
			observer = new IntersectionObserver((entries) => {
				for (const entry of entries)
					if (entry.isIntersecting) {
						observer.unobserve(entry.target);
						hydrateGithubCard(entry.target);
					}
			});
			for (const card of cards) observer.observe(card);
		});
	}
	scan();
	return {
		update: scan,
		destroy() {
			cancelAnimationFrame(frame);
			observer?.disconnect();
		},
	};
}
