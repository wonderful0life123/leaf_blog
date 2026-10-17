import { z } from "astro/zod";
export const postSchema = z.object({
	title: z.string(),
	articleId: z.string().optional(),
	published: z.date(),
	updated: z.date().optional(),
	draft: z.boolean().optional().default(false),
	description: z.string().optional().default(""),
	image: z.string().optional().default(""),
	tags: z.array(z.string()).optional().default([]),
	category: z.string().optional().nullable().default(""),
	lang: z.string().optional().default(""),
	pinned: z.boolean().optional().default(false),
	author: z.string().optional().default(""),
	sourceLink: z.string().optional().default(""),
	licenseName: z.string().optional().default(""),
	licenseUrl: z.string().optional().default(""),
	comment: z.boolean().optional().default(true),
	password: z.string().optional().default(""),
	passwordHint: z.string().optional().default(""),

	/* For internal use */
	prevTitle: z.string().default(""),
	prevSlug: z.string().default(""),
	nextTitle: z.string().default(""),
	nextSlug: z.string().default(""),
});
