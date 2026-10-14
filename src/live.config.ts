import { defineLiveCollection } from "astro:content";
import { publishedLoader } from "./runtime/loader";
export const collections = {
	published: defineLiveCollection({ loader: publishedLoader }),
};
