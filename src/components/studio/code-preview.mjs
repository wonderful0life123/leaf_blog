import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";

// Plain text is always available; unknown languages and failed language loads keep it intact.
export async function codeSegments(code, language) {
	if (
		["text", "txt", "plaintext", "plain", ""].includes(language.toLowerCase())
	)
		return [{ text: code, classes: "" }];
	const name = language.toLowerCase();
	const description = LanguageDescription.matchLanguageName(
		languages,
		name === "cuda" ? "cpp" : name,
		true,
	);
	if (!description || code.length > 100_000)
		return [{ text: code, classes: "" }];
	try {
		const support = await description.load();
		const segments = [];
		highlightCode(
			code,
			support.language.parser.parse(code),
			classHighlighter,
			(text, classes) => segments.push({ text, classes }),
			() => segments.push({ text: "\n", classes: "" }),
		);
		return segments;
	} catch {
		return [{ text: code, classes: "" }];
	}
}
