import {
	type CollectionEntry,
	getCollection,
	getLiveCollection,
} from "astro:content";
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
		return getCollection("posts", filter);
	const result = await getLiveCollection("published");
	if (result.error) throw result.error;
	const entries = result.entries!.map((entry) => ({
		...entry,
		body: entry.data.runtimeBody,
		filePath: "src/content/posts/" + entry.id + ".md",
	}));
	return filter
		? (entries as PublishedPost[]).filter(filter)
		: (entries as PublishedPost[]);
}
