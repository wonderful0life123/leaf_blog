// Location options are projected from the shared folder tree.
export function categoryLevels(folders, value = "") {
	const byId = new Map(folders.map((folder) => [folder.id, folder]));
	const paths = new Map();
	function path(id, seen = new Set()) {
		if (paths.has(id)) return paths.get(id);
		const folder = byId.get(id);
		if (!folder || seen.has(id)) return null;
		const next = new Set(seen).add(id);
		const parent = folder.parent === null ? "" : path(folder.parent, next);
		const result =
			parent === null ? null : (parent ? parent + "/" : "") + folder.name;
		paths.set(id, result);
		return result;
	}
	const valid = folders.filter((folder) => path(folder.id) !== null);
	const selected = valid.find((folder) => paths.get(folder.id) === value);
	const chain = [];
	for (let folder = selected; folder; folder = byId.get(folder.parent))
		chain.unshift(folder);
	const levels = [];
	let parent = null;
	for (let index = 0; ; index++) {
		const children = valid
			.filter((folder) => folder.parent === parent)
			.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		if (index > 0 && !children.length) break;
		const parentValue = parent === null ? "" : paths.get(parent);
		const options = [
			{ value: parentValue, label: index === 0 ? "根目录" : "留在此目录" },
		];
		if (index === 0 && value && !selected)
			options.push({ value, label: "原位置：" + value });
		options.push(
			...children.map((folder) => ({
				value: paths.get(folder.id),
				label: folder.name,
			})),
		);
		levels.push({
			index,
			value: chain[index]
				? paths.get(chain[index].id)
				: index === 0 && value && !selected
					? value
					: parentValue,
			options,
		});
		if (!chain[index]) break;
		parent = chain[index].id;
	}
	return { levels, legacy: !!value && !selected };
}
