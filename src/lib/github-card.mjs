export function githubRepo(value) {
	return typeof value === "string" &&
		/^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/i.test(value) &&
		![".", ".."].includes(value.split("/")[1])
		? value
		: null;
}

export function githubCard(repo, element, id = "") {
	if (!githubRepo(repo)) return null;
	const props = (className, suffix) => ({
		class: className,
		...(id && suffix ? { id: `${id}-${suffix}` } : {}),
	});
	const [owner, name] = repo.split("/");
	return element(
		"a",
		{
			...props("card-github no-styling", "card"),
			href: `https://github.com/${repo}`,
			target: "_blank",
			rel: "noopener noreferrer",
		},
		[
			element("div", props("gc-titlebar"), [
				element("div", props("gc-titlebar-left"), [
					element("div", props("gc-owner"), [
						element("div", props("gc-avatar", "avatar"), []),
						element("div", props("gc-user"), [owner]),
					]),
					element("div", props("gc-divider"), ["/"]),
					element("div", props("gc-repo"), [name]),
				]),
				element("div", props("github-logo"), []),
			]),
			element("div", props("gc-description", "description"), [
				"查看 GitHub 仓库",
			]),
			element("div", props("gc-infobar"), [
				element("div", props("gc-stars", "stars"), ["—"]),
				element("div", props("gc-forks", "forks"), ["—"]),
				element("div", props("gc-license", "license"), ["—"]),
				element("span", props("gc-language", "language"), []),
			]),
		],
	);
}
const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			],
	);
export function githubCardHtml(repo) {
	const element = (tag, props, children) => ({
		html: `<${tag}${Object.entries(props)
			.map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
			.join(
				"",
			)}>${children.map((child) => (typeof child === "object" ? child.html : escapeHtml(child))).join("")}</${tag}>`,
	});
	return githubCard(repo, element)?.html || "";
}
