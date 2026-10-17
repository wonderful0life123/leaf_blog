import {
	type CollectionEntry,
	getCollection,
	getLiveCollection,
} from "astro:content";
import archive from "../data/public-archive.json";
import { withArchivePath } from "../lib/public-archive.mjs";
export type PublishedPost = CollectionEntry<"posts"> & {
	data: CollectionEntry<"posts">["data"] & {
		runtimeBody?: string;
		runtimeRender?: { headings: any[]; remarkPluginFrontmatter: any };
	};
};
// Compile-time switch keeps ordinary static/Studio builds on the existing path.
export async function getPosts(
	_name = "posts",
	filter?: (entry: PublishedPost) => boolean,
): Promise<PublishedPost[]> {
	if (
		!import.meta.env.WONDER_RUNTIME_BUILD ||
		process.env.WONDER_RUNTIME_COMPILING === "1"
	)
		return (await getCollection("posts", filter)).map((entry) =>
			withArchivePath(entry, archive),
		);
	const result = await getLiveCollection("published");
	if (result.error) throw result.error;
	const entries = result.entries!.map((entry) => ({
		...entry,
		body: entry.data.runtimeBody,
		filePath:
			"src/content/posts/" + (entry.data.sourcePath || entry.id + ".md"),
	}));
	return filter
		? (entries as PublishedPost[]).filter(filter)
		: (entries as PublishedPost[]);
}
