/* Create a new post from templates/post.md */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const targetDir = path.resolve("src/content/posts");
const defaultTemplatePath = path.resolve("templates/post.md");
const fileExtensionRegex = /\.(md|mdx)$/i;

const booleanOptions = new Set([
	"draft",
	"dry-run",
	"help",
	"mdx",
	"no-comment",
	"pinned",
]);
const valueOptions = new Set([
	"author",
	"category",
	"description",
	"image",
	"lang",
	"license-name",
	"license-url",
	"published",
	"source-link",
	"tags",
	"template",
	"title",
	"updated",
]);

function usage() {
	return `Usage:
  pnpm new-post <path> [options]

Examples:
  pnpm new-post llm-algorithms/python-basics/list-knowledge --title "Python list 知识点" --category "大模型算法/Python基础/list知识点" --tags "Python,list,基础"
  pnpm new-post notes/today --title "今日记录" --draft
  node scripts/new-post.js demo/post --title "预览" --dry-run

Options:
  --title <text>         文章标题，默认由文件名生成
  --category <path>      分类，支持多级，例如 "大模型算法/Python基础"
  --tags <a,b,c>         标签，英文逗号分隔
  --description <text>   SEO 描述和文章摘要
  --image <path|url>     封面图，留空表示无封面
  --published <date>     发布日期，默认今天，格式 YYYY-MM-DD
  --updated <date>       更新日期，格式 YYYY-MM-DD
  --lang <code>          文章语言，例如 zh_CN
  --author <name>        作者名
  --source-link <url>    原文链接
  --license-name <text>  许可证名称
  --license-url <url>    许可证链接
  --draft               创建为草稿
  --pinned              创建为置顶文章
  --no-comment          关闭评论
  --mdx                 未写扩展名时创建 .mdx
  --template <path>      使用自定义模板，默认 templates/post.md
  --dry-run             只预览，不写入文件`;
}

function fail(message) {
	console.error(`Error: ${message}`);
	console.error(usage());
	process.exit(1);
}

function parseArgs(argv) {
	const positional = [];
	const options = {};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) {
			positional.push(arg);
			continue;
		}

		const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s);
		if (!rawKey) fail(`Invalid option ${arg}`);

		if (booleanOptions.has(rawKey)) {
			options[rawKey] = inlineValue === undefined ? true : inlineValue !== "false";
			continue;
		}

		if (!valueOptions.has(rawKey)) fail(`Unknown option --${rawKey}`);
		if (inlineValue !== undefined) {
			options[rawKey] = inlineValue;
			continue;
		}

		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			fail(`Missing value for --${rawKey}`);
		}
		options[rawKey] = next;
		i++;
	}

	return { positional, options };
}

function getDateInShanghai() {
	const parts = new Intl.DateTimeFormat("en", {
		day: "2-digit",
		month: "2-digit",
		timeZone: "Asia/Shanghai",
		year: "numeric",
	}).formatToParts(new Date());
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${values.year}-${values.month}-${values.day}`;
}

function normalizePostPath(input, extension) {
	const normalized = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (!normalized) fail("No filename argument provided");
	if (path.isAbsolute(normalized)) fail("Post path must be relative");
	if (normalized.split("/").includes("..")) {
		fail("Post path cannot contain '..'");
	}
	return fileExtensionRegex.test(normalized) ? normalized : `${normalized}${extension}`;
}

function titleFromPath(filePath) {
	const basename = path.posix.basename(filePath).replace(fileExtensionRegex, "");
	return basename.replace(/[-_]+/g, " ").trim() || basename;
}

function parseTags(value) {
	if (!value) return [];
	return value
		.split(",")
		.map((tag) => tag.trim())
		.filter(Boolean);
}

function yamlString(value) {
	return JSON.stringify(String(value ?? ""));
}

function yamlArray(values) {
	if (!values.length) return "[]";
	return `[${values.map(yamlString).join(", ")}]`;
}

function renderTemplate(template, values) {
	return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
		if (!(key in values)) return "";
		return values[key];
	});
}

const { positional, options } = parseArgs(process.argv.slice(2));

if (options.help) {
	console.log(usage());
	process.exit(0);
}

if (positional.length === 0) {
	fail("No filename argument provided");
}
if (positional.length > 1) {
	fail(`Unexpected positional arguments: ${positional.slice(1).join(" ")}`);
}

const extension = options.mdx ? ".mdx" : ".md";
const postPath = normalizePostPath(positional[0], extension);
const fullPath = path.join(targetDir, postPath);
const relativePath = path.relative(process.cwd(), fullPath);

if (!fullPath.startsWith(`${targetDir}${path.sep}`)) {
	fail("Post path must stay inside src/content/posts");
}

if (fs.existsSync(fullPath) && !options["dry-run"]) {
	fail(`File ${relativePath} already exists`);
}

const templatePath = path.resolve(String(options.template || defaultTemplatePath));
if (!fs.existsSync(templatePath)) {
	fail(`Template ${path.relative(process.cwd(), templatePath)} does not exist`);
}

const template = fs.readFileSync(templatePath, "utf8");
const title = String(options.title || titleFromPath(postPath));
const content = renderTemplate(template, {
	author: yamlString(options.author || ""),
	bodyTitle: title,
	category: yamlString(options.category || ""),
	comment: options["no-comment"] ? "false" : "true",
	description: yamlString(options.description || ""),
	draft: options.draft ? "true" : "false",
	image: yamlString(options.image || ""),
	lang: yamlString(options.lang || ""),
	licenseName: yamlString(options["license-name"] || ""),
	licenseUrl: yamlString(options["license-url"] || ""),
	pinned: options.pinned ? "true" : "false",
	published: String(options.published || getDateInShanghai()),
	slug: postPath.replace(fileExtensionRegex, ""),
	sourceLink: yamlString(options["source-link"] || ""),
	tags: yamlArray(parseTags(String(options.tags || ""))),
	title: yamlString(title),
	updatedLine: options.updated ? `updated: ${options.updated}` : "",
});

if (options["dry-run"]) {
	console.log(`Target: ${relativePath}`);
	console.log("---");
	console.log(content);
	process.exit(0);
}

const dirPath = path.dirname(fullPath);
if (!fs.existsSync(dirPath)) {
	fs.mkdirSync(dirPath, { recursive: true });
}

fs.writeFileSync(fullPath, content);

console.log(`Post ${relativePath} created`);
