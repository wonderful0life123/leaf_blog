import { articleFolder, folderPath } from "../../lib/studio-organization.mjs";
// Article identity survives confirmed moves; folder selection determines future paths.
export function blogPath(article) {
	if (article.publication?.path) return article.publication.path;
	if (article.persisted)
		return article.source?.root === "blog" ? article.source.path : "";
	return article.root === "blog" ? article.path || "" : "";
}
export function articleKey(article) {
	if (article.persisted) return `draft:${article.id}`;
	const path = blogPath(article);
	return path ? `blog:${path}` : `draft:${article.id}`;
}
export function mergeArticles(drafts, catalog) {
	const identity = (a) => a.articleId || blogPath(a);
	const originals = new Map(
		catalog.map((article) => [identity(article), article]),
	);
	const covered = new Set(drafts.map(identity).filter(Boolean));
	return [
		...drafts.map((draft) => ({
			...draft,
			repositoryStatus: originals.get(identity(draft))?.status,
			directoryNeedsAlignment: originals.get(identity(draft))
				?.directoryNeedsAlignment,
		})),
		...catalog.filter((article) => !covered.has(identity(article))),
	];
}
export function isPublished(article) {
	return (
		!!article.publication ||
		article.status === "published" ||
		article.repositoryStatus === "published"
	);
}
export function buildArticleTree(items, organization = null) {
	if (organization) {
		const root = {
			id: "root",
			label: "全部文章",
			type: "folder",
			path: "",
			children: [],
			count: 0,
		};
		const nodes = new Map(
			organization.folders.map((f) => [
				f.id,
				{
					...f,
					label: f.name,
					type: "folder",
					path: folderPath(organization.folders, f.id),
					children: [],
					count: 0,
				},
			]),
		);
		for (const f of organization.folders)
			(nodes.get(f.parent) || root).children.push(nodes.get(f.id));
		let unfiled;
		for (const article of items) {
			const parentId = articleFolder(article, organization);
			let parent = parentId === null ? root : nodes.get(parentId);
			if (!parent) {
				if (!unfiled) {
					unfiled = {
						id: "unfiled:/未归档草稿",
						label: "未归档草稿",
						type: "folder",
						path: "",
						children: [],
						count: 0,
						unfiled: true,
					};
					root.children.push(unfiled);
				}
				parent = unfiled;
			}
			parent.children.push({
				id: articleKey(article),
				label: article.title || "未命名文章",
				type: "article",
				article,
			});
		}
		function count(n) {
			n.children.sort(
				(a, b) =>
					(a.type === "folder" ? 0 : 1) - (b.type === "folder" ? 0 : 1) ||
					(a.type === "folder" && b.type === "folder"
						? a.label.localeCompare(b.label, "zh-CN")
						: 0),
			);
			n.count = n.children.reduce(
				(sum, c) => sum + (c.type === "folder" ? count(c) : 1),
				0,
			);
			return n.count;
		}
		count(root);
		return root;
	}
	const root = {
		id: "root",
		label: "全部文章",
		type: "folder",
		path: "",
		children: [],
		count: 0,
	};
	const folders = new Map([["", root]]);
	for (const article of items) {
		const path = blogPath(article);
		const segments = path ? path.split("/").slice(0, -1) : ["未归档草稿"];
		let parent = root;
		let prefix = "";
		for (const segment of segments) {
			prefix += "/" + segment;
			const key = (path ? "path:" : "unfiled:") + prefix;
			if (!folders.has(key)) {
				const folder = {
					id: key,
					label: segment,
					type: "folder",
					path: path ? prefix.slice(1) : "",
					children: [],
					count: 0,
					unfiled: !path,
				};
				folders.set(key, folder);
				parent.children.push(folder);
			}
			parent = folders.get(key);
		}
		parent.children.push({
			id: articleKey(article),
			label: article.title || "未命名文章",
			type: "article",
			article,
		});
	}
	function count(folder) {
		folder.children.sort(
			(a, b) =>
				(a.type === "folder" ? 0 : 1) - (b.type === "folder" ? 0 : 1) ||
				(a.type === "folder" && b.type === "folder"
					? a.label.localeCompare(b.label, "zh-CN")
					: 0),
		);
		folder.count = folder.children.reduce(
			(total, child) => total + (child.type === "folder" ? count(child) : 1),
			0,
		);
		return folder.count;
	}
	count(root);
	return root;
}
export function flattenArticleTree(
	root,
	collapsed = new Set(),
	forceOpen = false,
) {
	const rows = [];
	function visit(folder, depth) {
		for (const node of folder.children) {
			rows.push({ ...node, depth, parent: folder.id });
			if (node.type === "folder" && (forceOpen || !collapsed.has(node.id)))
				visit(node, depth + 1);
		}
	}
	visit(root, 0);
	return rows;
}
