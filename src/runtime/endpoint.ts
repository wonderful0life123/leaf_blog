// Resource responses are emitted by the runtime middleware; no directory listing.
export const prerender = false;
export function GET() {
	return new Response("Not found", { status: 404 });
}
