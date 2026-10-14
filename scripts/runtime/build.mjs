import { execFileSync } from "node:child_process";
execFileSync(process.execPath, ["scripts/studio/build-preview.mjs"], {
	stdio: "inherit",
});
execFileSync(process.execPath, ["scripts/generate-icons.js"], {
	stdio: "inherit",
});
execFileSync(process.execPath, ["node_modules/astro/bin/astro.mjs", "build"], {
	stdio: "inherit",
	env: {
		...process.env,
		WONDER_RUNTIME_BUILD: "1",
		WONDER_RUNTIME_COMPILING: "1",
		WONDER_STUDIO_BUILD: "0",
		WONDER_STUDIO_LOCAL: "0",
		ASTRO_TELEMETRY_DISABLED: "1",
	},
});
