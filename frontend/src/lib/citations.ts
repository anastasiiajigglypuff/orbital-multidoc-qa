// Shared, pure helpers for the "Verified Citations" feature.
//
// The backend emits two distinct shapes (see the frozen contract):
//   - STREAMING: raw text with inline markers `[[cite:<doc_id>::<verbatim quote>]]`
//     that must never be shown to the user (verification hasn't happened yet).
//   - RESOLVED (final "message" event + reload): a clean body containing inline
//     `[[c:N]]` tokens, followed by a CITATIONS JSON block between sentinels.

export interface Citation {
	n: number;
	doc_id: string;
	quote: string;
	verified: boolean;
}

export interface ResolvedContent {
	body: string;
	citations: Citation[];
	amber: boolean;
}

const CITATIONS_START = "<<<CITATIONS>>>";
const CITATIONS_END = "<<<END CITATIONS>>>";

// Matches a COMPLETE raw streaming marker: `[[cite:` ... `]]`.
// The quote may contain ":" and a single "]" but never "]]", so we consume
// lazily up to the first "]]".
const COMPLETE_MARKER = /\[\[cite:.*?\]\]/gs;

/**
 * Remove raw streaming citation markers so they never flash mid-stream.
 *
 * Strips every COMPLETE `[[cite:...]]` span, and also drops a trailing OPEN
 * `[[cite:` (or any partial prefix of it) at the very tail that has no closing
 * `]]` yet — this is the marker being streamed in chunk-by-chunk. Anything
 * before a still-open marker is preserved.
 */
export function stripStreamingMarkers(text: string): string {
	if (!text) return text;

	// 1. Remove all fully-formed markers.
	let out = text.replace(COMPLETE_MARKER, "");

	// 2. Drop a trailing, not-yet-closed marker. Find the last `[[cite:`; if it
	//    has no `]]` after it, it's still streaming — hide from that point on.
	const openIdx = out.lastIndexOf("[[cite:");
	if (openIdx !== -1 && out.indexOf("]]", openIdx) === -1) {
		out = out.slice(0, openIdx);
	}

	return out;
}

/**
 * Split resolved content into its body (still containing `[[c:N]]` tokens),
 * the parsed citation list, and the server-authoritative `amber` flag.
 *
 * Degrades gracefully: a missing or malformed CITATIONS block yields
 * `{ body: content, citations: [], amber: false }` and never throws.
 */
export function parseResolvedContent(content: string): ResolvedContent {
	const startIdx = content.indexOf(CITATIONS_START);
	if (startIdx === -1) {
		return { body: content, citations: [], amber: false };
	}

	const body = content.slice(0, startIdx).replace(/\s+$/, "");
	const afterStart = content.slice(startIdx + CITATIONS_START.length);
	const endIdx = afterStart.indexOf(CITATIONS_END);
	const jsonRaw = (endIdx === -1 ? afterStart : afterStart.slice(0, endIdx)).trim();

	try {
		const parsed = JSON.parse(jsonRaw) as {
			citations?: unknown;
			amber?: unknown;
		};
		const citations = Array.isArray(parsed.citations)
			? parsed.citations
					.map((c) => c as Partial<Citation>)
					.filter(
						(c): c is Citation =>
							typeof c.n === "number" &&
							typeof c.doc_id === "string" &&
							typeof c.quote === "string",
					)
					.map((c) => ({
						n: c.n,
						doc_id: c.doc_id,
						quote: c.quote,
						verified: Boolean(c.verified),
					}))
			: [];
		const amber = parsed.amber === true;
		return { body, citations, amber };
	} catch {
		// Malformed JSON — keep the body but surface no citations.
		return { body, citations: [], amber: false };
	}
}

// Superscript digit glyphs so inline markers stay plain text (markdown-safe)
// and don't rely on custom Streamdown components.
const SUPERSCRIPTS: Record<string, string> = {
	"0": "⁰",
	"1": "¹",
	"2": "²",
	"3": "³",
	"4": "⁴",
	"5": "⁵",
	"6": "⁶",
	"7": "⁷",
	"8": "⁸",
	"9": "⁹",
};

function toSuperscript(n: string): string {
	return n
		.split("")
		.map((d) => SUPERSCRIPTS[d] ?? d)
		.join("");
}

/**
 * Replace inline `[[c:N]]` tokens with a markdown-safe inline superscript
 * marker (e.g. a superscript bracketed number) before handing the body to
 * <Streamdown>. Inline markers are not clickable — the Sources footer is the
 * clickable surface.
 */
export function renderBodyWithSuperscripts(body: string): string {
	return body.replace(/\[\[c:(\d+)\]\]/g, (_m, n: string) => {
		return ` [${toSuperscript(n)}]`;
	});
}
