import { nameSegment, pathKey } from "./article-paths.mjs";
// Desired organization stays private until an explicit publication confirms it.
export class OrganizationError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}
const fail = (status, message) => {
	throw new OrganizationError(status, message);
};
export function sourcePath(a) {
	return (
		a.publication?.path ||
		(a.persisted
			? a.source?.root === "blog"
				? a.source.path
				: ""
			: a.root === "blog"
				? a.path
				: "") ||
		""
	);
}
export function placementKey(a) {
	return a.articleId && sourcePath(a)
		? "article:" + a.articleId
		: sourcePath(a)
			? "blog:" + sourcePath(a)
			: "draft:" + a.id;
}
export function seedOrganization(saved, items) {
	const state = {
		revision: saved?.revision || 0,
		folders: structuredClone(saved?.folders || []),
		placements: { ...(saved?.placements || {}) },
		undoToken: saved?.undoToken || null,
	};
	const ids = new Set(state.folders.map((f) => f.id));
	for (const a of [...items].sort(
		(a, b) => Number(!!b.persisted) - Number(!!a.persisted),
	)) {
		const key = placementKey(a);
		const draftKey = "draft:" + a.id;
		if (Object.hasOwn(state.placements, key)) continue;
		const oldKey = "blog:" + sourcePath(a);
		if (a.articleId && Object.hasOwn(state.placements, oldKey)) {
			state.placements[key] = state.placements[oldKey];
			continue;
		}
		if (a.persisted && Object.hasOwn(state.placements, draftKey)) {
			state.placements[key] = state.placements[draftKey];
			continue;
		}
		const path = sourcePath(a);
		if (!path) continue;
		let parent = null;
		const parts = [];
		for (const name of path.split("/").slice(0, -1)) {
			parts.push(name);
			const id = "folder:" + parts.join("/");
			if (!ids.has(id)) {
				state.folders.push({ id, name, parent });
				ids.add(id);
			}
			parent = id;
		}
		state.placements[key] = parent;
	}
	return state;
}
export function articleFolder(a, state) {
	const key = placementKey(a);
	if (Object.hasOwn(state.placements, key)) return state.placements[key];
	return a.persisted && Object.hasOwn(state.placements, "draft:" + a.id)
		? state.placements["draft:" + a.id]
		: undefined;
}
export function folderSegments(folders, selectedId) {
	let id = selectedId;
	const parts = [];
	const seen = new Set();
	while (id) {
		if (seen.has(id)) break;
		seen.add(id);
		const f = folders.find((n) => n.id === id);
		if (!f) break;
		parts.unshift(f.name);
		id = f.parent;
	}
	return parts;
}
export function folderPath(folders, id) {
	return folderSegments(folders, id).join(" / ");
}
export function withinFolder(folders, selectedId, ancestor) {
	let id = selectedId;
	const seen = new Set();
	while (id) {
		if (id === ancestor) return true;
		if (seen.has(id)) return false;
		seen.add(id);
		id = folders.find((f) => f.id === id)?.parent;
	}
	return false;
}
export function moveOrganization(current, input, items) {
	if (input?.revision !== current.revision)
		fail(409, "目录已在其他页面更新，请刷新后重新选择。");
	const state = structuredClone(current);
	const target = input.target;
	if (target !== null && !state.folders.some((f) => f.id === target))
		fail(400, "目标目录不存在。");
	if (input.kind === "folder") {
		const folder = state.folders.find((f) => f.id === input.id);
		if (!folder) fail(404, "目录不存在。");
		if (withinFolder(state.folders, target, folder.id))
			fail(400, "不能移动到自身或自己的子目录。");
		if (folder.parent === target) fail(400, "已经在这个目录中。");
		if (
			state.folders.some(
				(f) =>
					f.id !== folder.id &&
					f.parent === target &&
					pathKey(f.name) === pathKey(folder.name),
			)
		)
			fail(409, "目标位置已有同名目录，请选择其他位置。");
		folder.parent = target;
	} else if (input.kind === "article") {
		const a = items.find(
			(a) =>
				(a.persisted ? "draft:" + a.id : "blog:" + sourcePath(a)) === input.id,
		);
		if (!a) fail(404, "文章不存在或已移入回收站。");
		if (articleFolder(a, state) === target) fail(400, "已经在这个目录中。");
		state.placements[placementKey(a)] = target;
		if (a.persisted) state.placements["draft:" + a.id] = target;
	} else fail(400, "移动对象无效。");
	state.revision++;
	return state;
}

export function editFolderOrganization(current, input, items, newId) {
	if (input?.revision !== current.revision)
		fail(409, "目录已在其他页面更新，请刷新后重试。");
	const state = structuredClone(current);
	const folder =
		input.action === "create"
			? null
			: state.folders.find((f) => f.id === input.id);
	if (!["create", "rename", "delete"].includes(input.action))
		fail(400, "目录操作无效。");
	if (input.action !== "create" && !folder) fail(404, "目录不存在。");
	if (input.action === "delete") {
		if (
			state.folders.some((f) => f.parent === folder.id) ||
			items.some((a) => articleFolder(a, state) === folder.id)
		)
			fail(409, "只能删除空目录，请先移出文章（包括回收站中的文章）和子目录。");
		state.folders = state.folders.filter((f) => f.id !== folder.id);
	} else {
		let name;
		try {
			name = nameSegment(input.name);
		} catch (e) {
			fail(400, "目录名无效：" + e.message);
		}
		if (
			!name ||
			name.length > 80 ||
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem names and URLs.
			/[\\/\u0000-\u001f\u007f]/.test(name) ||
			[".", ".."].includes(name)
		)
			fail(400, "目录名需为 1–80 个字符，不能包含斜杠或控制字符。");
		const parent = input.action === "create" ? input.parent : folder.parent;
		if (parent !== null && !state.folders.some((f) => f.id === parent))
			fail(404, "上级目录不存在。");
		if (
			state.folders.some(
				(f) =>
					f.id !== folder?.id &&
					f.parent === parent &&
					pathKey(f.name) === pathKey(name),
			)
		)
			fail(409, "这个位置已有同名目录。");
		if (input.action === "create") {
			if (!newId || state.folders.some((f) => f.id === newId))
				fail(400, "目录编号无效。");
			state.folders.push({ id: newId, name, parent });
		} else {
			if (folder.name === name) fail(400, "目录名称没有改变。");
			folder.name = name;
		}
	}
	state.revision++;
	return state;
}

export function targetArticlePath(article, state, filename) {
	const id = articleFolder(article, state);
	const folder = id == null ? "" : folderSegments(state.folders, id).join("/");
	const name = filename || sourcePath(article).split("/").at(-1);
	return [folder, name].filter(Boolean).join("/");
}
