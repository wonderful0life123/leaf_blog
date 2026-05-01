<script lang="ts">
import { onMount } from "svelte";

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	categoryMatchesFilter,
	getCategoryLabel,
	getCategoryPathFromSegments,
	getCategorySegments,
	normalizeCategoryPath,
} from "@/utils/category-utils";
import { getPostUrlBySlug } from "@/utils/url-utils";

interface Post {
	id: string;
	data: {
		title: string;
		tags: string[];
		category?: string | null;
		published: Date;
	};
}

interface Group {
	year: number;
	posts: Post[];
}

interface ArchiveTreeNode {
	name: string;
	leafName: string;
	depth: number;
	posts: Post[];
	totalPosts: number;
	children: ArchiveTreeNode[];
}

interface ActiveFilter {
	labelKey: I18nKey;
	values: string[];
}

interface Props {
	tags?: string[];
	categories?: string[];
	sortedPosts?: Post[];
}

let { tags = [], categories = [], sortedPosts = [] }: Props = $props();

const params = new URLSearchParams(window.location.search);
tags = params.has("tag") ? params.getAll("tag") : [];
categories = params.has("category") ? params.getAll("category") : [];
const uncategorized = params.get("uncategorized");

let groups: Group[] = $state([]);
let categoryTree: ArchiveTreeNode[] = $state([]);
let activeFilters: ActiveFilter[] = $state([]);
let primaryFilter: ActiveFilter | null = $state(null);
let secondaryFilters: ActiveFilter[] = $state([]);
let filteredPostCount = $state(0);
let expandedArchivePaths = $state(new Set<string>());

function formatDate(date: Date) {
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${month}-${day}`;
}

function formatTag(tagList: string[]) {
	return tagList.map((t) => `#${t}`).join(" ");
}

function formatFilterValues(filter: ActiveFilter) {
	const prefix = filter.labelKey === I18nKey.tags ? "#" : "";
	return filter.values
		.map((value) =>
			filter.labelKey === I18nKey.categories
				? getCategoryLabel(value) || value
				: `${prefix}${value}`,
		)
		.join(" / ");
}

function resolvePrimaryFilter(filters: ActiveFilter[]) {
	return (
		filters.find((filter) => filter.labelKey === I18nKey.tags) ??
		filters[0] ??
		null
	);
}

function formatFilterSummary(filters: ActiveFilter[]) {
	return filters
		.map((filter) => `${i18n(filter.labelKey)}: ${formatFilterValues(filter)}`)
		.join("  ·  ");
}

function sortPostsByDate(posts: Post[]) {
	return posts
		.slice()
		.sort((a, b) => b.data.published.getTime() - a.data.published.getTime());
}

function createNode(path: string, segments: string[]): ArchiveTreeNode {
	return {
		name: path,
		leafName: segments.at(-1) || path,
		depth: Math.max(0, segments.length - 1),
		posts: [],
		totalPosts: 0,
		children: [],
	};
}

function buildArchiveCategoryTree(posts: Post[]): ArchiveTreeNode[] {
	const nodeMap = new Map<string, ArchiveTreeNode>();

	for (const post of posts) {
		const segments = getCategorySegments(post.data.category);
		if (segments.length === 0) continue;

		for (let i = 0; i < segments.length; i++) {
			const path = getCategoryPathFromSegments(segments.slice(0, i + 1));
			if (!nodeMap.has(path)) {
				nodeMap.set(path, createNode(path, segments.slice(0, i + 1)));
			}
		}

		const fullPath = getCategoryPathFromSegments(segments);
		nodeMap.get(fullPath)?.posts.push(post);
	}

	for (const node of nodeMap.values()) {
		const segments = getCategorySegments(node.name);
		if (segments.length < 2) continue;
		const parentPath = getCategoryPathFromSegments(segments.slice(0, -1));
		nodeMap.get(parentPath)?.children.push(node);
	}

	for (const node of nodeMap.values()) {
		node.posts = sortPostsByDate(node.posts);
		node.children.sort((a, b) => a.leafName.localeCompare(b.leafName));
	}

	const calculateTotal = (node: ArchiveTreeNode): number => {
		node.totalPosts =
			node.posts.length +
			node.children.reduce((sum, child) => sum + calculateTotal(child), 0);
		return node.totalPosts;
	};

	const roots = [...nodeMap.values()].filter((node) => node.depth === 0);
	for (const root of roots) {
		calculateTotal(root);
	}

	return roots.sort((a, b) => a.leafName.localeCompare(b.leafName));
}

function getVisibleArchiveRoots(
	roots: ArchiveTreeNode[],
	activeCategories: string[],
): ArchiveTreeNode[] {
	if (activeCategories.length === 0) return roots;

	const activePaths = activeCategories.map((category) =>
		normalizeCategoryPath(category),
	);

	const findNode = (nodes: ArchiveTreeNode[], path: string): ArchiveTreeNode | null => {
		for (const node of nodes) {
			if (node.name === path) return node;
			const child = findNode(node.children, path);
			if (child) return child;
		}
		return null;
	};

	const visible = activePaths
		.map((path) => findNode(roots, path))
		.filter((node): node is ArchiveTreeNode => !!node);

	return visible.length > 0 ? visible : roots;
}

function getDefaultExpandedArchivePaths(
	roots: ArchiveTreeNode[],
	activeCategories: string[],
) {
	const activePaths = activeCategories.map((category) =>
		normalizeCategoryPath(category),
	);
	const nextExpandedPaths = new Set<string>();

	const shouldExpandNode = (node: ArchiveTreeNode) => {
		if (node.children.length === 0) return false;
		if (activePaths.length === 0) return node.depth === 0;
		return activePaths.some(
			(path) =>
				path === node.name ||
				path.startsWith(`${node.name}/`) ||
				node.name.startsWith(`${path}/`),
		);
	};

	const visit = (node: ArchiveTreeNode) => {
		if (shouldExpandNode(node)) {
			nextExpandedPaths.add(node.name);
		}
		for (const child of node.children) {
			visit(child);
		}
	};

	for (const root of roots) {
		visit(root);
	}

	return nextExpandedPaths;
}

function isArchiveNodeExpanded(node: ArchiveTreeNode) {
	return node.children.length === 0 || expandedArchivePaths.has(node.name);
}

function toggleArchiveNode(path: string) {
	const nextExpandedPaths = new Set(expandedArchivePaths);
	if (nextExpandedPaths.has(path)) {
		nextExpandedPaths.delete(path);
	} else {
		nextExpandedPaths.add(path);
	}
	expandedArchivePaths = nextExpandedPaths;
}

onMount(async () => {
	let filteredPosts: Post[] = sortedPosts;
	const currentFilters: ActiveFilter[] = [];

	if (categories.length > 0) {
		currentFilters.push({ labelKey: I18nKey.categories, values: categories });
	}

	if (uncategorized) {
		currentFilters.push({
			labelKey: I18nKey.categories,
			values: [i18n(I18nKey.uncategorized)],
		});
	}

	if (tags.length > 0) {
		currentFilters.push({ labelKey: I18nKey.tags, values: tags });
	}

	activeFilters = currentFilters;
	primaryFilter = resolvePrimaryFilter(activeFilters);
	secondaryFilters = primaryFilter
		? activeFilters.filter((filter) => filter !== primaryFilter)
		: [];

	if (tags.length > 0) {
		filteredPosts = filteredPosts.filter(
			(post) =>
				Array.isArray(post.data.tags) &&
				post.data.tags.some((tag) => tags.includes(tag)),
		);
	}

	if (categories.length > 0) {
		filteredPosts = filteredPosts.filter(
			(post) =>
				post.data.category &&
				categories.some((category) =>
					categoryMatchesFilter(post.data.category, category),
				),
		);
	}

	if (uncategorized) {
		filteredPosts = filteredPosts.filter((post) => !post.data.category);
	}

	// 按发布时间倒序排序，确保不受置顶影响
	filteredPosts = sortPostsByDate(filteredPosts);

	filteredPostCount = filteredPosts.length;
	categoryTree = getVisibleArchiveRoots(
		buildArchiveCategoryTree(filteredPosts),
		categories,
	);
	expandedArchivePaths = getDefaultExpandedArchivePaths(categoryTree, categories);

	const grouped = filteredPosts.reduce(
		(acc, post) => {
			const year = post.data.published.getFullYear();
			if (!acc[year]) {
				acc[year] = [];
			}
			acc[year].push(post);
			return acc;
		},
		{} as Record<number, Post[]>,
	);

	const groupedPostsArray = Object.keys(grouped).map((yearStr) => ({
		year: Number.parseInt(yearStr, 10),
		posts: grouped[Number.parseInt(yearStr, 10)],
	}));

	groupedPostsArray.sort((a, b) => b.year - a.year);

	groups = groupedPostsArray;
});
</script>

{#snippet PostLink(post: Post)}
	<a
		href={getPostUrlBySlug(post.id)}
		aria-label={post.data.title}
		class="archive-post-link group btn-plain block! h-10 w-full rounded-lg hover:text-[initial]"
	>
		<div class="flex flex-row justify-start items-center h-full">
			<div class="w-[15%] md:w-[10%] transition text-sm text-right text-50">
				{formatDate(post.data.published)}
			</div>

			<div class="w-[15%] md:w-[10%] relative dash-line h-full flex items-center">
				<div
					class="transition-all mx-auto w-1 h-1 rounded group-hover:h-5
                       bg-[oklch(0.5_0.05_var(--hue))] group-hover:bg-(--primary)
                       outline outline-4 z-50
                       outline-(--card-bg)
                       group-hover:outline-(--btn-plain-bg-hover)
                       group-active:outline-(--btn-plain-bg-active)"
				></div>
			</div>

			<div
				class="w-[70%] md:max-w-[65%] md:w-[65%] text-left font-bold
                     group-hover:translate-x-1 transition-all group-hover:text-(--primary)
                     text-75 pr-8 whitespace-nowrap text-ellipsis overflow-hidden"
			>
				{post.data.title}
			</div>

			<div
				class="hidden md:block md:w-[15%] text-left text-sm transition
                     whitespace-nowrap text-ellipsis overflow-hidden text-30"
			>
				{formatTag(post.data.tags)}
			</div>
		</div>
	</a>
{/snippet}

{#snippet CategoryNode(node: ArchiveTreeNode)}
	{@const expanded = isArchiveNodeExpanded(node)}
	<section class="archive-category-node" style={`--archive-depth: ${node.depth};`}>
		<div class="archive-category-header">
			{#if node.children.length > 0}
				<button
					type="button"
					class="archive-category-toggle"
					class:is-collapsed={!expanded}
					aria-expanded={String(expanded)}
					aria-label={`${expanded ? "收起" : "展开"} ${node.leafName}`}
					onclick={() => toggleArchiveNode(node.name)}
				></button>
			{:else}
				<div class="archive-category-branch" aria-hidden="true"></div>
			{/if}
			<a class="archive-category-title" href={`/archive/?category=${encodeURIComponent(node.name)}`}>
				<span>{node.leafName}</span>
			</a>
			<span class="archive-category-count">{node.totalPosts}</span>
		</div>

		{#if expanded && node.posts.length > 0}
			<div class="archive-category-posts">
				{#each node.posts as post}
					{@render PostLink(post)}
				{/each}
			</div>
		{/if}

		{#if expanded && node.children.length > 0}
			<div class="archive-category-children">
				{#each node.children as child}
					{@render CategoryNode(child)}
				{/each}
			</div>
		{/if}
	</section>
{/snippet}

<div class="card-base px-8 py-6">
	{#if primaryFilter}
		<div class="mb-5">
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
				<div class="min-w-0 text-sm text-75">
					<span class="text-50">{i18n(primaryFilter.labelKey)}</span>
					<span class="mx-2 text-30">/</span>
					<span class="font-semibold text-(--primary)">{formatFilterValues(primaryFilter)}</span>
					{#if secondaryFilters.length > 0}
						<span class="ml-2 text-50">· {formatFilterSummary(secondaryFilters)}</span>
					{/if}
				</div>
				<div class="shrink-0 text-xs text-50">
					{filteredPostCount} {i18n(filteredPostCount === 1 ? I18nKey.postCount : I18nKey.postsCount)}
					<span class="mx-1.5 text-30">·</span>
					{groups.length} {i18n(I18nKey.year)}
				</div>
			</div>
		</div>
	{/if}

	{#if categoryTree.length > 0}
		<div class="archive-category-tree">
			{#each categoryTree as node}
				{@render CategoryNode(node)}
			{/each}
		</div>
	{:else}
		{#each groups as group}
			<div>
				<div class="flex flex-row w-full items-center h-15">
					<div class="w-[15%] md:w-[10%] transition text-2xl font-bold text-right text-75">
						{group.year}
					</div>
					<div class="w-[15%] md:w-[10%]">
						<div
							class="h-3 w-3 bg-none rounded-full outline outline-(--primary) mx-auto
                  -outline-offset-2 z-50 outline-3"
						></div>
					</div>
					<div class="w-[70%] md:w-[80%] transition text-left text-50">
						{group.posts.length} {i18n(group.posts.length === 1 ? I18nKey.postCount : I18nKey.postsCount)}
					</div>
				</div>

				{#each group.posts as post}
					{@render PostLink(post)}
				{/each}
			</div>
		{/each}
	{/if}
</div>

<style>
	.archive-category-tree {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.archive-category-node {
		--archive-indent: calc(var(--archive-depth) * 0.25rem);
		min-width: 0;
	}

	.archive-category-header {
		min-height: 2.8rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding-left: var(--archive-indent);
	}

	.archive-category-toggle,
	.archive-category-branch {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 999px;
		border: 1.5px solid var(--primary);
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		flex: 0 0 auto;
	}

	.archive-category-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--primary);
		cursor: pointer;
		transition:
			background-color 150ms ease,
			transform 150ms ease;
	}

	.archive-category-toggle::before {
		content: "";
		width: 0.36rem;
		height: 0.36rem;
		border-right: 2px solid currentColor;
		border-bottom: 2px solid currentColor;
		transform: rotate(45deg) translate(-0.04rem, -0.04rem);
		transition: transform 150ms ease;
	}

	.archive-category-toggle.is-collapsed::before {
		transform: rotate(-45deg) translate(-0.03rem, 0.04rem);
	}

	.archive-category-toggle:hover {
		background: color-mix(in srgb, var(--primary) 18%, transparent);
	}

	.archive-category-title {
		min-width: 0;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		font-size: 1rem;
		font-weight: 800;
		color: var(--btn-content);
		transition: color 150ms ease;
	}

	.archive-category-title:hover {
		color: var(--primary);
	}

	.archive-category-count {
		min-width: 2.2rem;
		height: 1.75rem;
		padding: 0 0.6rem;
		border-radius: 0.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.95 0.025 var(--hue));
		color: var(--btn-content);
		font-size: 0.875rem;
		font-weight: 800;
		flex: 0 0 auto;
	}

	.archive-category-posts {
		margin-left: calc(0.55rem + var(--archive-indent));
		padding-left: 1.35rem;
		border-left: 1px dashed var(--line-divider);
	}

	.archive-category-children {
		margin-left: calc(0.55rem + var(--archive-indent));
		padding-left: 1.35rem;
		border-left: 1px dashed var(--line-divider);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.archive-post-link {
		max-width: 100%;
	}

	:global(.dark) .archive-category-count {
		background: var(--primary);
		color: var(--deep-text);
	}

	@media (max-width: 640px) {
		.archive-category-header {
			gap: 0.5rem;
		}

		.archive-category-posts,
		.archive-category-children {
			margin-left: 0.35rem;
			padding-left: 0.85rem;
		}
	}
</style>
