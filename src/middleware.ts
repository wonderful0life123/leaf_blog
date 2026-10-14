import { defineMiddleware } from "astro:middleware";
import { runtimeRequest } from "./runtime/middleware";
export const onRequest = defineMiddleware((context, next) =>
	import.meta.env.WONDER_RUNTIME_BUILD &&
	process.env.WONDER_RUNTIME_COMPILING !== "1"
		? runtimeRequest(context, next)
		: next(),
);
