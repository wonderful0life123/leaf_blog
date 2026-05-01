<script lang="ts">
	import { onMount } from "svelte";

	export interface CategoryTreeNode {
		name: string;
		leafName: string;
		count: number;
		url: string;
		depth: number;
		hasChildren: boolean;
		children: CategoryTreeNode[];
	}

	interface Props {
		nodes?: CategoryTreeNode[];
		initialActivePath?: string;
	}

	let { nodes = [], initialActivePath = "" }: Props = $props();

	const normalizePath = (value: string) =>
		value
			.split(/(?:\/|\\|->|→|＞|>)/g)
			.map((segment) => segment.trim())
			.filter(Boolean)
			.join("/");

	let activePath = $state(normalizePath(initialActivePath));
	let expandedPaths = $state(new Set<string>());

	function getActivePathFromLocation() {
		if (typeof window === "undefined") return "";
		const params = new URLSearchParams(window.location.search);
		return normalizePath(params.get("category") || "");
	}

	function shouldExpandForActivePath(path: string) {
		const normalizedPath = normalizePath(path);
		if (!activePath || !normalizedPath) return false;
		return (
			activePath === normalizedPath ||
			activePath.startsWith(`${normalizedPath}/`)
		);
	}

	function collectExpandedPaths(items: CategoryTreeNode[]) {
		const nextExpandedPaths = new Set<string>();
		const visit = (node: CategoryTreeNode) => {
			if (node.hasChildren && shouldExpandForActivePath(node.name)) {
				nextExpandedPaths.add(normalizePath(node.name));
			}
			for (const child of node.children) {
				visit(child);
			}
		};

		for (const node of items) {
			visit(node);
		}

		return nextExpandedPaths;
	}

	function resetExpandedPaths() {
		expandedPaths = collectExpandedPaths(nodes);
	}

	function setActivePath(nextActivePath: string) {
		activePath = normalizePath(nextActivePath);
		resetExpandedPaths();
	}

	function isExpanded(path: string) {
		return expandedPaths.has(normalizePath(path));
	}

	function isActive(path: string) {
		return activePath === normalizePath(path);
	}

	function isAncestor(path: string) {
		const normalizedPath = normalizePath(path);
		return !!(
			activePath &&
			normalizedPath &&
			activePath.startsWith(`${normalizedPath}/`)
		);
	}

	function toggleNode(path: string) {
		const normalizedPath = normalizePath(path);
		if (!normalizedPath) return;

		const nextExpandedPaths = new Set(expandedPaths);
		if (nextExpandedPaths.has(normalizedPath)) {
			nextExpandedPaths.delete(normalizedPath);
		} else {
			nextExpandedPaths.add(normalizedPath);
		}
		expandedPaths = nextExpandedPaths;
	}

	onMount(() => {
		setActivePath(getActivePathFromLocation() || initialActivePath);

		const handleActivePath = (event: Event) => {
			const detail =
				event instanceof CustomEvent && typeof event.detail === "string"
					? event.detail
					: getActivePathFromLocation();
			setActivePath(detail);
		};

		document.addEventListener("astro:page-load", handleActivePath);
		document.addEventListener("swup:contentReplaced", handleActivePath);
		window.addEventListener("category-tree:active-path", handleActivePath);

		return () => {
			document.removeEventListener("astro:page-load", handleActivePath);
			document.removeEventListener("swup:contentReplaced", handleActivePath);
			window.removeEventListener("category-tree:active-path", handleActivePath);
		};
	});
</script>

{#snippet TreeLevel(levelNodes: CategoryTreeNode[], level: number)}
	<ul class="category-tree-level" data-level={level}>
		{#each levelNodes as node}
			{@const expanded = !node.hasChildren || isExpanded(node.name)}
			<li
				class="category-tree-item"
				data-tree-node
				data-tree-path={node.name}
				data-tree-label={node.leafName}
				data-tree-has-children={String(node.hasChildren)}
				data-expanded={String(expanded)}
			>
				<div class="category-tree-row">
					{#if node.hasChildren}
						<button
							type="button"
							class="tree-toggle"
							class:is-collapsed={!expanded}
							aria-label={`${expanded ? "收起" : "展开"} ${node.leafName}`}
							aria-expanded={String(expanded)}
							onclick={() => toggleNode(node.name)}
						></button>
					{:else}
						<span class="tree-dot" aria-hidden="true"></span>
					{/if}

					<a
						href={node.url}
						class="category-tree-link"
						class:has-children={node.hasChildren}
						data-category-path={node.name}
						data-active={isActive(node.name) ? "" : undefined}
						data-ancestor={isAncestor(node.name) ? "" : undefined}
						style={`--category-level: ${level};`}
						aria-label={`View all posts in the ${node.name} category`}
					>
						<span class="category-tree-name">{node.leafName}</span>
						<span class="category-tree-count">{node.count}</span>
					</a>
				</div>

				{#if node.children.length > 0}
					<div class="category-tree-children" hidden={!expanded}>
						{@render TreeLevel(node.children, level + 1)}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="category-tree-root">
	{@render TreeLevel(nodes, 0)}
</div>

<style>
	.category-tree-root {
		min-width: 0;
	}

	.category-tree-level {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
	}

	.category-tree-item {
		position: relative;
	}

	.category-tree-row {
		min-height: 2.4rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.category-tree-children {
		margin: 0.12rem 0 0.12rem 0.45rem;
		padding-left: 0.9rem;
		border-left: 1px dashed
			color-mix(in srgb, var(--line-divider) 92%, transparent);
	}

	.category-tree-link {
		min-width: 0;
		min-height: 2.35rem;
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border-radius: 0.5rem;
		padding: 0.35rem 0.6rem 0.35rem
			calc(0.6rem + var(--category-level) * 0.1rem);
		color: var(--btn-content);
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--primary) 8%, transparent) 0,
			transparent 28%
		);
		transition:
			color 150ms ease,
			background-color 150ms ease,
			padding-left 150ms ease,
			transform 150ms ease;
	}

	.category-tree-link:hover {
		color: var(--primary);
		background: var(--btn-plain-bg-hover);
		transform: translateX(0.12rem);
	}

	.category-tree-link[data-active] {
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		color: var(--primary);
		box-shadow: inset 0 0 0 1px
			color-mix(in srgb, var(--primary) 20%, transparent);
	}

	.category-tree-link[data-ancestor] {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
		color: color-mix(in srgb, var(--primary) 84%, var(--btn-content));
	}

	.tree-toggle,
	.tree-dot {
		flex: 0 0 auto;
		width: 1.45rem;
		height: 1.45rem;
		border-radius: 999px;
		border: 1.5px solid currentColor;
		color: var(--btn-content);
		opacity: 0.62;
	}

	.tree-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		transition:
			color 150ms ease,
			background-color 150ms ease,
			transform 150ms ease,
			opacity 150ms ease;
	}

	.tree-toggle::before {
		content: "";
		width: 0.38rem;
		height: 0.38rem;
		border-right: 2px solid currentColor;
		border-bottom: 2px solid currentColor;
		transform: rotate(45deg) translate(-0.05rem, -0.05rem);
		transition: transform 150ms ease;
	}

	.tree-toggle.is-collapsed::before {
		transform: rotate(-45deg) translate(-0.04rem, 0.04rem);
	}

	.tree-toggle:hover {
		color: var(--primary);
		opacity: 1;
		background: color-mix(in srgb, var(--primary) 18%, transparent);
	}

	.tree-dot {
		border: none;
		opacity: 0.42;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.tree-dot::before {
		content: "";
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 999px;
		border: 1.5px solid currentColor;
	}

	.category-tree-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.category-tree-count {
		flex: 0 0 auto;
		min-width: 2.15rem;
		height: 1.75rem;
		padding: 0 0.6rem;
		border-radius: 0.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.95 0.025 var(--hue));
		color: var(--btn-content);
		font-size: 0.875rem;
		font-weight: 700;
	}

	:global(.dark) .category-tree-count {
		background: var(--primary);
		color: var(--deep-text);
	}
</style>
