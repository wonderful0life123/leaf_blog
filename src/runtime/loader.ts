import fs from "node:fs";
import path from "node:path";
import type { LiveLoader } from "astro/loaders";
import { releaseContext } from "./context";
let cachedPath = "",
	cached: {
		format: number;
		codeRevision: string;
		entries: Array<{
			id: string;
			data: Record<string, any>;
			rendered: { html: string };
		}>;
	};
export function currentRelease() {
	const dir =
		releaseContext.getStore() ||
		fs.realpathSync(process.env.WONDER_RUNTIME_LIVE_LINK!);
	if (dir !== cachedPath) {
		const snapshot = JSON.parse(
			fs.readFileSync(path.join(dir, "published.json"), "utf8"),
		);
		if (
			snapshot.format !== 1 ||
			snapshot.codeRevision !== process.env.WONDER_RUNTIME_CODE_REVISION
		)
			throw Error("Public content and running code revisions differ");
		cached = snapshot;
		cachedPath = dir;
	}
	return cached;
}
function entries() {
	return currentRelease().entries.map((entry) => ({
		id: entry.id,
		data: {
			...entry.data,
			published: new Date(entry.data.published),
			...(entry.data.updated ? { updated: new Date(entry.data.updated) } : {}),
		},
		rendered: entry.rendered,
	}));
}
export const publishedLoader: LiveLoader<
	Record<string, any>,
	{ id: string }
> = {
	name: "wonder-published-release",
	async loadCollection() {
		return { entries: entries() };
	},
	async loadEntry({ filter }) {
		return entries().find((entry) => entry.id === filter.id);
	},
};
