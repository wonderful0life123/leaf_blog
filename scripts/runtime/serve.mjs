import fs from "node:fs";
import path from "node:path";
import { validateRuntimePaths } from "./release.mjs";
if (process.env.WONDER_RUNTIME_COMPILING)
	throw Error("Compile-only flag cannot be set on the public service");
const config = {
	repoDir: process.cwd(),
	codeRevision: process.env.WONDER_RUNTIME_CODE_REVISION,
	releaseDir: process.env.WONDER_RUNTIME_RELEASE_DIR,
	liveLink: process.env.WONDER_RUNTIME_LIVE_LINK,
};
validateRuntimePaths(config);
const snapshot = JSON.parse(
	fs.readFileSync(path.join(config.liveLink, "published.json"), "utf8"),
);
if (snapshot.codeRevision !== config.codeRevision || snapshot.format !== 1)
	throw Error("Runtime release/code mismatch");
process.env.HOST = "127.0.0.1";
process.env.PORT = process.env.WONDER_RUNTIME_PORT || "4313";
if (
	!/^\d+$/.test(process.env.PORT) ||
	Number(process.env.PORT) < 1 ||
	Number(process.env.PORT) > 65535
)
	throw Error("Invalid runtime port");
await import("../../runtime-dist/server/entry.mjs");
