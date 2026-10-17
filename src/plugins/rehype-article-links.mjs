import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { visit } from "unist-util-visit";
import { legacyArticleRoute, postUrl } from "../lib/article-paths.mjs";

export default function articleLinks() {
	return (tree, file) => {
		if (!file.path) return;
		const root = path.resolve("src/content/posts");
		const source = path.resolve(file.path);
		if (!source.startsWith(root + path.sep)) return;
		visit(tree, "element", (node) => {
			if (node.tagName !== "a" || typeof node.properties?.href !== "string")
				return;
			const href = node.properties.href;
			if (/^(?:[a-z][\w+.-]*:|[/#])/i.test(href)) return;
			const match = href.match(/^([^?#]+)(.*)$/);
			if (!match || !decodeURIComponent(match[1]).endsWith(".md")) return;
			const target = path.resolve(
				path.dirname(source),
				decodeURIComponent(match[1]),
			);
			if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) return;
			const { data } = matter(fs.readFileSync(target, "utf8"));
			if (!data.draft)
				node.properties.href =
					postUrl(legacyArticleRoute(path.relative(root, target), data)) +
					match[2];
		});
	};
}
