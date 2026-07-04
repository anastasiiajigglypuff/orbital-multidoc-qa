import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";
import { stripStreamingMarkers } from "../lib/citations";
import type { Message } from "../types";

export function useMessages(conversationId: string | null) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [streamingContent, setStreamingContent] = useState("");
	const abortRef = useRef<AbortController | null>(null);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setMessages([]);
			return;
		}
		try {
			setLoading(true);
			setError(null);
			const data = await api.fetchMessages(conversationId);
			setMessages(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load messages");
		} finally {
			setLoading(false);
		}
	}, [conversationId]);

	useEffect(() => {
		refresh();
		return () => {
			if (abortRef.current) {
				abortRef.current.abort();
			}
		};
	}, [refresh]);

	// Shared SSE reader used by both chat replies and upload summaries. Streams the
	// assistant text into `streamingContent`, then reconciles with server-canonical
	// messages by refetching.
	const consumeStream = useCallback(async (response: Response, cid: string) => {
		if (!response.body) throw new Error("No response body");

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let accumulated = "";
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || !trimmed.startsWith("data: ")) continue;

				const data = trimmed.slice(6);
				if (data === "[DONE]") continue;

				try {
					const parsed = JSON.parse(data) as {
						type?: string;
						content?: string;
						delta?: string;
						message?: Message;
					};

					if (parsed.type === "delta" && parsed.delta) {
						accumulated += parsed.delta;
						// Strip raw [[cite:...]] markers (including a partial open
						// marker at the tail) so they never flash mid-stream. We
						// accumulate the RAW text so markers split across SSE chunks
						// rejoin before stripping.
						setStreamingContent(stripStreamingMarkers(accumulated));
					} else if (parsed.type === "content" && parsed.content) {
						accumulated += parsed.content;
						setStreamingContent(stripStreamingMarkers(accumulated));
					} else if (parsed.type === "message" && parsed.message) {
						setMessages((prev) => [...prev, parsed.message as Message]);
						accumulated = "";
					} else if (parsed.content && !parsed.type) {
						accumulated += parsed.content;
						setStreamingContent(stripStreamingMarkers(accumulated));
					}
				} catch {
					// Skip invalid JSON lines
				}
			}
		}

		// If we accumulated content but never got a final message event,
		// synthesize an assistant message so nothing is lost.
		if (accumulated) {
			const assistantMessage: Message = {
				id: `stream-${Date.now()}`,
				conversation_id: cid,
				role: "assistant",
				// Fallback path: no resolved "message" event arrived, so strip raw
				// markers rather than leaking them. The refetch below normally
				// replaces this with server-canonical resolved content.
				content: stripStreamingMarkers(accumulated),
				sources_cited: 0,
				created_at: new Date().toISOString(),
			};
			setMessages((prev) => [...prev, assistantMessage]);
		}

		// Refresh to get server-canonical messages
		const freshMessages = await api.fetchMessages(cid);
		setMessages(freshMessages);
	}, []);

	const send = useCallback(
		async (content: string) => {
			if (!conversationId || streaming) return;

			const userMessage: Message = {
				id: `temp-${Date.now()}`,
				conversation_id: conversationId,
				role: "user",
				content,
				sources_cited: 0,
				created_at: new Date().toISOString(),
			};

			setMessages((prev) => [...prev, userMessage]);
			setStreaming(true);
			setStreamingContent("");
			setError(null);

			try {
				const response = await api.sendMessage(conversationId, content);
				await consumeStream(response, conversationId);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setError(err instanceof Error ? err.message : "Failed to send message");
			} finally {
				setStreaming(false);
				setStreamingContent("");
			}
		},
		[conversationId, streaming, consumeStream],
	);

	// Stream a proactive assistant summary of just-uploaded documents.
	const streamSummary = useCallback(
		async (documentIds: string[]) => {
			if (!conversationId || streaming || documentIds.length === 0) return;

			setStreaming(true);
			setStreamingContent("");
			setError(null);

			try {
				const response = await api.streamDocumentSummary(
					conversationId,
					documentIds,
				);
				await consumeStream(response, conversationId);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setError(
					err instanceof Error ? err.message : "Failed to summarize documents",
				);
			} finally {
				setStreaming(false);
				setStreamingContent("");
			}
		},
		[conversationId, streaming, consumeStream],
	);

	return {
		messages,
		loading,
		error,
		streaming,
		streamingContent,
		send,
		streamSummary,
		refresh,
	};
}
