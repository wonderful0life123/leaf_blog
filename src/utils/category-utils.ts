export const CATEGORY_PATH_SEPARATOR = "/";

const CATEGORY_SPLIT_PATTERN = /(?:\/|\\|->|→|＞|>)/g;

export function getCategorySegments(category?: string | null): string[] {
	if (!category) return [];
	return String(category)
		.split(CATEGORY_SPLIT_PATTERN)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

export function normalizeCategoryPath(category?: string | null): string {
	return getCategorySegments(category).join(CATEGORY_PATH_SEPARATOR);
}

export function getCategoryPathFromSegments(segments: string[]): string {
	return segments.map((segment) => segment.trim()).filter(Boolean).join(CATEGORY_PATH_SEPARATOR);
}

export function getCategoryPathPrefixes(category?: string | null): string[] {
	const segments = getCategorySegments(category);
	const prefixes: string[] = [];
	for (let i = 0; i < segments.length; i++) {
		prefixes.push(getCategoryPathFromSegments(segments.slice(0, i + 1)));
	}
	return prefixes;
}

export function getCategoryLabel(category?: string | null): string {
	return getCategorySegments(category).join(" / ");
}

export function getCategoryLeafName(category?: string | null): string {
	const segments = getCategorySegments(category);
	return segments.at(-1) || "";
}

export function getCategoryDepth(category?: string | null): number {
	const segments = getCategorySegments(category);
	return Math.max(0, segments.length - 1);
}

export function categoryMatchesFilter(
	category?: string | null,
	filter?: string | null,
): boolean {
	const categoryPath = normalizeCategoryPath(category);
	const filterPath = normalizeCategoryPath(filter);
	if (!categoryPath || !filterPath) return false;
	return categoryPath === filterPath || categoryPath.startsWith(`${filterPath}${CATEGORY_PATH_SEPARATOR}`);
}
