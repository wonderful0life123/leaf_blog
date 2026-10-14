// Run on a reviewed checkout with publishing disabled; creates a separate first snapshot.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
	buildRuntimeRelease,
	closeRuntimeIndexer,
	validateRuntimePaths,
} from "./release.mjs";
const repoDir = process.cwd(),
	codeRevision = process.env.WONDER_RUNTIME_CODE_REVISION;
const releaseDir = process.env.WONDER_RUNTIME_RELEASE_DIR,
	liveLink = process.env.WONDER_RUNTIME_LIVE_LINK;
validateRuntimePaths({ repoDir, codeRevision, releaseDir, liveLink });
if (
	execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
	codeRevision
)
	throw Error("Initialize from the exact deployed revision");
if (
	execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
		encoding: "utf8",
	}).trim()
)
	throw Error("Initialize requires a clean reviewed checkout");
if (
	fs.existsSync(liveLink) ||
	fs.lstatSync(path.dirname(liveLink)).isSymbolicLink()
)
	throw Error("Initialize never replaces an existing live link");
const id = "code-" + codeRevision,
	target = path.join(releaseDir, id);
if (fs.existsSync(target)) throw Error("Initial release already exists");
try {
	await buildRuntimeRelease(repoDir, target, { repoDir, codeRevision, id });
	fs.symlinkSync(target, liveLink);
	console.log("Created initial published snapshot: " + id);
} finally {
	await closeRuntimeIndexer();
}
