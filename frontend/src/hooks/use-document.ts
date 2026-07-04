import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

export function useDocument(conversationId: string | null) {
	const [documents, setDocuments] = useState<Document[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setDocuments([]);
			setSelectedId(null);
			return;
		}
		try {
			setError(null);
			const detail = await api.fetchConversation(conversationId);
			const docs = detail.documents ?? [];
			setDocuments(docs);
			// Keep the current selection if it still exists; otherwise default to the
			// first document so the viewer always shows something when docs are present.
			setSelectedId((prev) => {
				if (prev && docs.some((d) => d.id === prev)) return prev;
				return docs[0]?.id ?? null;
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load documents");
		}
	}, [conversationId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const selectDocument = useCallback((id: string) => {
		setSelectedId(id);
	}, []);

	const upload = useCallback(
		async (files: File[]) => {
			if (!conversationId || files.length === 0) return null;
			try {
				setUploading(true);
				setError(null);
				const newDocs = await api.uploadDocuments(conversationId, files);
				// Additive: merge into existing documents, never drop what's loaded.
				setDocuments((prev) => [...prev, ...newDocs]);
				// Auto-select the newest upload so the user sees what they just added.
				const newest = newDocs[newDocs.length - 1];
				if (newest) setSelectedId(newest.id);
				return newDocs;
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to upload documents",
				);
				return null;
			} finally {
				setUploading(false);
			}
		},
		[conversationId],
	);

	const selectedDocument =
		documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;

	return {
		documents,
		selectedDocument,
		selectedId,
		selectDocument,
		uploading,
		error,
		upload,
		refresh,
	};
}
