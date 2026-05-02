import type { CollectionEntry } from "astro:content";
import { profileConfig, siteConfig } from "@/config";
import { getDefaultBackground } from "@/utils/layout-utils";
import { removeFileExtension } from "@/utils/url-utils";

const SITE_URL = siteConfig.site_url.replace(/\/+$/, "");
const DEFAULT_OG_IMAGE = "/assets/images/og-default.webp";

function absoluteUrl(pathOrUrl: string | URL | undefined): string | undefined {
	if (!pathOrUrl) return undefined;
	const value = String(pathOrUrl);
	if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) {
		return value;
	}
	return new URL(value, `${SITE_URL}/`).toString();
}

export function getCanonicalUrl(pathname: string): string {
	const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
	return new URL(normalizedPath, `${SITE_URL}/`).toString();
}

export function getDefaultOgImageUrl(): string | undefined {
	return absoluteUrl(DEFAULT_OG_IMAGE || getDefaultBackground());
}

export function getPostOgImageUrl(
	processedImage: string | undefined,
	generatedOgImageUrl?: string,
): string | undefined {
	return absoluteUrl(generatedOgImageUrl || processedImage || DEFAULT_OG_IMAGE);
}

export function getPageKeywords(extraKeywords: string[] = []): string[] {
	return [...new Set([...(siteConfig.keywords || []), ...extraKeywords])].filter(
		Boolean,
	);
}

export function getPostUrl(postId: string): string {
	return new URL(`/posts/${removeFileExtension(postId)}/`, `${SITE_URL}/`).toString();
}

export function createWebsiteJsonLd() {
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: siteConfig.title,
		alternateName: siteConfig.subtitle || undefined,
		url: `${SITE_URL}/`,
		description: siteConfig.description,
		inLanguage: siteConfig.lang.replace("_", "-"),
		publisher: {
			"@type": "Person",
			name: profileConfig.name,
			url: `${SITE_URL}/about/`,
		},
		potentialAction: {
			"@type": "SearchAction",
			target: `${SITE_URL}/search/?q={search_term_string}`,
			"query-input": "required name=search_term_string",
		},
	};
}

export function createBlogPostingJsonLd(
	entry: CollectionEntry<"posts">,
	imageUrl?: string,
) {
	const postUrl = getPostUrl(entry.id);
	const lang = entry.data.lang
		? entry.data.lang.replace("_", "-")
		: siteConfig.lang.replace("_", "-");

	return {
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		"@id": `${postUrl}#article`,
		mainEntityOfPage: {
			"@type": "WebPage",
			"@id": postUrl,
		},
		headline: entry.data.title,
		description: entry.data.description || siteConfig.description || entry.data.title,
		image: imageUrl ? [imageUrl] : undefined,
		keywords: entry.data.tags,
		articleSection: entry.data.category || undefined,
		author: {
			"@type": "Person",
			name: entry.data.author || profileConfig.name,
			url: `${SITE_URL}/about/`,
		},
		publisher: {
			"@type": "Person",
			name: profileConfig.name,
			url: `${SITE_URL}/about/`,
		},
		datePublished: entry.data.published.toISOString(),
		dateModified: (entry.data.updated || entry.data.published).toISOString(),
		inLanguage: lang,
		url: postUrl,
	};
}
