import type {
	Conversation,
	ConversationDetail,
	Document,
	Message,
} from "../types";

const BASE = "/api";

async function errorMessage(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	// FastAPI returns { "detail": "..." } — surface that human-readable message
	// rather than the raw JSON envelope.
	try {
		const parsed = JSON.parse(text) as { detail?: unknown };
		if (typeof parsed.detail === "string") return parsed.detail;
	} catch {
		// not JSON; fall through
	}
	return text || `Request failed (${response.status})`;
}

async function handleResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw new Error(await errorMessage(response));
	}
	return response.json() as Promise<T>;
}

export async function fetchConversations(): Promise<Conversation[]> {
	const res = await fetch(`${BASE}/conversations`);
	return handleResponse<Conversation[]>(res);
}

export async function createConversation(): Promise<Conversation> {
	const res = await fetch(`${BASE}/conversations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "New conversation" }),
	});
	return handleResponse<Conversation>(res);
}

export async function deleteConversation(id: string): Promise<void> {
	const res = await fetch(`${BASE}/conversations/${id}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		throw new Error(await errorMessage(res));
	}
}

export async function fetchConversation(
	id: string,
): Promise<ConversationDetail> {
	const res = await fetch(`${BASE}/conversations/${id}`);
	return handleResponse<ConversationDetail>(res);
}

export async function fetchMessages(
	conversationId: string,
): Promise<Message[]> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages`);
	return handleResponse<Message[]>(res);
}

export async function sendMessage(
	conversationId: string,
	content: string,
): Promise<Response> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content }),
	});
	if (!res.ok) {
		throw new Error(await errorMessage(res));
	}
	return res;
}

export async function uploadDocuments(
	conversationId: string,
	files: File[],
): Promise<Document[]> {
	const formData = new FormData();
	for (const file of files) {
		formData.append("files", file);
	}
	const res = await fetch(`${BASE}/conversations/${conversationId}/documents`, {
		method: "POST",
		body: formData,
	});
	return handleResponse<Document[]>(res);
}

export async function streamDocumentSummary(
	conversationId: string,
	documentIds: string[],
): Promise<Response> {
	const res = await fetch(
		`${BASE}/conversations/${conversationId}/documents/summary`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ document_ids: documentIds }),
		},
	);
	if (!res.ok) {
		throw new Error(await errorMessage(res));
	}
	return res;
}

export function getDocumentUrl(documentId: string): string {
	return `${BASE}/documents/${documentId}/content`;
}
