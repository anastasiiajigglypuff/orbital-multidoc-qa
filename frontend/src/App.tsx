import { useCallback } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentViewer } from "./components/DocumentViewer";
import { TooltipProvider } from "./components/ui/tooltip";
import { useConversations } from "./hooks/use-conversations";
import { useDocument } from "./hooks/use-document";
import { useMessages } from "./hooks/use-messages";

export default function App() {
	const {
		conversations,
		selectedId,
		loading: conversationsLoading,
		create,
		select,
		remove,
		refresh: refreshConversations,
	} = useConversations();

	const {
		messages,
		loading: messagesLoading,
		error: messagesError,
		streaming,
		streamingContent,
		send,
		streamSummary,
	} = useMessages(selectedId);

	const {
		documents,
		selectedDocument,
		selectedId: selectedDocId,
		selectDocument,
		upload,
		error: documentError,
	} = useDocument(selectedId);

	const handleSend = useCallback(
		async (content: string) => {
			await send(content);
			refreshConversations();
		},
		[send, refreshConversations],
	);

	const handleUpload = useCallback(
		async (files: File[]) => {
			const docs = await upload(files);
			if (docs && docs.length > 0) {
				refreshConversations();
				// Proactively stream a brief summary of the new document(s).
				await streamSummary(docs.map((d) => d.id));
			}
		},
		[upload, refreshConversations, streamSummary],
	);

	const handleCreate = useCallback(async () => {
		await create();
	}, [create]);

	return (
		<TooltipProvider delayDuration={200}>
			<div className="flex h-screen bg-neutral-50">
				<ChatSidebar
					conversations={conversations}
					selectedId={selectedId}
					loading={conversationsLoading}
					onSelect={select}
					onCreate={handleCreate}
					onDelete={remove}
				/>

				<ChatWindow
					messages={messages}
					loading={messagesLoading}
					error={messagesError ?? documentError}
					streaming={streaming}
					streamingContent={streamingContent}
					hasDocument={documents.length > 0}
					conversationId={selectedId}
					documents={documents}
					onSend={handleSend}
					onUpload={handleUpload}
					onSelectDocument={selectDocument}
				/>

				<DocumentViewer
					documents={documents}
					selectedId={selectedDocId}
					onSelect={selectDocument}
					selectedDocument={selectedDocument}
				/>
			</div>
		</TooltipProvider>
	);
}
