import { Loader2, UploadCloud } from "lucide-react";
import {
	type DragEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useMemo } from "react";
import type { Document, Message } from "../types";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import { MessageBubble, StreamingBubble } from "./MessageBubble";

interface ChatWindowProps {
	messages: Message[];
	loading: boolean;
	error: string | null;
	streaming: boolean;
	streamingContent: string;
	hasDocument: boolean;
	conversationId: string | null;
	documents: Document[];
	onSend: (content: string) => void;
	onUpload: (files: File[]) => void;
	onSelectDocument: (docId: string) => void;
}

const dragHasFiles = (e: DragEvent) =>
	Array.from(e.dataTransfer.types).includes("Files");

export function ChatWindow({
	messages,
	loading,
	error,
	streaming,
	streamingContent,
	hasDocument,
	conversationId,
	documents,
	onSend,
	onUpload,
	onSelectDocument,
}: ChatWindowProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	// doc_id -> display title, used to label citation Sources entries.
	const docTitles = useMemo(() => {
		const map: Record<string, string> = {};
		for (const doc of documents) map[doc.id] = doc.filename;
		return map;
	}, [documents]);
	const [dragOver, setDragOver] = useState(false);
	// Track nested dragenter/dragleave so the overlay doesn't flicker as the cursor
	// moves over child elements.
	const dragDepth = useRef(0);

	// Auto-scroll to bottom when new messages arrive or during streaming
	const messagesLength = messages.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: messages and streamingContent are intentional triggers for auto-scroll
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messagesLength, streamingContent]);

	const handleDragEnter = useCallback((e: DragEvent) => {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		dragDepth.current += 1;
		setDragOver(true);
	}, []);

	const handleDragOver = useCallback((e: DragEvent) => {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) setDragOver(false);
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			dragDepth.current = 0;
			setDragOver(false);
			const pdfs = Array.from(e.dataTransfer.files).filter(
				(f) =>
					f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
			);
			if (pdfs.length > 0) onUpload(pdfs);
		},
		[onUpload],
	);

	// No conversation selected
	if (!conversationId) {
		return (
			<div className="flex flex-1 items-center justify-center bg-neutral-50">
				<div className="text-center">
					<p className="text-sm text-neutral-400">
						Select a conversation or create a new one
					</p>
				</div>
			</div>
		);
	}

	// Loading messages
	if (loading) {
		return (
			<div className="flex flex-1 items-center justify-center bg-white">
				<Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
			</div>
		);
	}

	const dropOverlay = dragOver && (
		<div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-400 bg-neutral-50/90 backdrop-blur-sm">
			<UploadCloud className="mb-3 h-10 w-10 text-neutral-500" />
			<p className="text-sm font-medium text-neutral-700">
				Drop your document here
			</p>
			<p className="mt-1 text-xs text-neutral-400">
				PDFs are added to this conversation
			</p>
		</div>
	);

	const dragHandlers = {
		onDragEnter: handleDragEnter,
		onDragOver: handleDragOver,
		onDragLeave: handleDragLeave,
		onDrop: handleDrop,
	};

	// Empty conversation - show upload prompt
	if (messages.length === 0 && !streaming) {
		return (
			<div className="relative flex flex-1 flex-col bg-white" {...dragHandlers}>
				{dropOverlay}
				{error && (
					<div className="mx-4 mt-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
						{error}
					</div>
				)}
				<div className="flex flex-1 items-center justify-center">
					{hasDocument ? (
						<div className="text-center">
							<p className="text-sm text-neutral-500">
								Documents uploaded. Ask a question to get started.
							</p>
						</div>
					) : (
						<EmptyState onUpload={onUpload} />
					)}
				</div>
				<ChatInput onSend={onSend} onUpload={onUpload} disabled={streaming} />
			</div>
		);
	}

	return (
		<div className="relative flex flex-1 flex-col bg-white" {...dragHandlers}>
			{dropOverlay}
			{error && (
				<div className="mx-4 mt-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
					{error}
				</div>
			)}

			<div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
				<div className="mx-auto max-w-2xl space-y-1">
					{messages.map((message) => (
						<MessageBubble
							key={message.id}
							message={message}
							docTitles={docTitles}
							onSelectDocument={onSelectDocument}
						/>
					))}
					{streaming && <StreamingBubble content={streamingContent} />}
				</div>
			</div>

			<ChatInput onSend={onSend} onUpload={onUpload} disabled={streaming} />
		</div>
	);
}
