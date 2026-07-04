import { motion } from "framer-motion";
import { AlertTriangle, Bot } from "lucide-react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import {
	type Citation,
	parseResolvedContent,
	renderBodyWithSuperscripts,
	stripStreamingMarkers,
} from "../lib/citations";
import type { Message } from "../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface MessageBubbleProps {
	message: Message;
	// Maps a document id to its display title; used to label Sources entries.
	docTitles?: Record<string, string>;
	// Switches the reader panel to the given document.
	onSelectDocument?: (docId: string) => void;
}

function CitationEntry({
	citation,
	title,
	onSelectDocument,
}: {
	citation: Citation;
	title: string | undefined;
	onSelectDocument?: (docId: string) => void;
}) {
	const label = title ?? "unknown source";
	const clickable = Boolean(title) && Boolean(onSelectDocument);

	const marker = (
		<span
			className={
				citation.verified
					? "font-medium text-neutral-500"
					: "font-medium text-amber-600"
			}
		>
			[{citation.n}]
		</span>
	);

	const quote = (
		<span
			className={
				citation.verified
					? "text-neutral-600"
					: "text-amber-700 line-through decoration-amber-400"
			}
		>
			"{citation.quote}"
		</span>
	);

	const source = clickable ? (
		<button
			type="button"
			onClick={() => onSelectDocument?.(citation.doc_id)}
			className="text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-800"
		>
			{label}
		</button>
	) : (
		<span className="text-neutral-400">{label}</span>
	);

	const row = (
		<div className="flex gap-1.5 text-xs leading-relaxed">
			{marker}
			<span className="min-w-0">
				{quote} <span className="text-neutral-400">— {source}</span>
			</span>
		</div>
	);

	if (citation.verified) return row;

	// Unverified: explain why with a tooltip.
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="cursor-help">{row}</div>
			</TooltipTrigger>
			<TooltipContent>Couldn't verify this quote in the document</TooltipContent>
		</Tooltip>
	);
}

export function MessageBubble({
	message,
	docTitles,
	onSelectDocument,
}: MessageBubbleProps) {
	if (message.role === "system") {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.2 }}
				className="flex justify-center py-2"
			>
				<p className="text-xs text-neutral-400">{message.content}</p>
			</motion.div>
		);
	}

	if (message.role === "user") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.2 }}
				className="flex justify-end py-1.5"
			>
				<div className="max-w-[75%] rounded-2xl rounded-br-md bg-neutral-100 px-4 py-2.5">
					<p className="whitespace-pre-wrap text-sm text-neutral-800">
						{message.content}
					</p>
				</div>
			</motion.div>
		);
	}

	// Assistant message — parse resolved content into body + citations + amber.
	const { body, citations, amber } = parseResolvedContent(message.content);
	const rendered = renderBodyWithSuperscripts(body);
	const verifiedCount = citations.filter((c) => c.verified).length;

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2 }}
			className="flex gap-3 py-1.5"
		>
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				<div className="prose">
					<Streamdown>{rendered}</Streamdown>
				</div>

				{amber && (
					<div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
						<span>
							Unverified — not grounded in your documents; verify before
							relying on it.
						</span>
					</div>
				)}

				{citations.length > 0 && (
					<div className="mt-2 space-y-1">
						{!amber && verifiedCount > 0 && (
							<p className="text-xs font-medium text-neutral-400">
								{verifiedCount} verified source
								{verifiedCount !== 1 ? "s" : ""}
							</p>
						)}
						<div className="space-y-1">
							{citations.map((c) => (
								<CitationEntry
									key={c.n}
									citation={c}
									title={docTitles?.[c.doc_id]}
									onSelectDocument={onSelectDocument}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</motion.div>
	);
}

interface StreamingBubbleProps {
	content: string;
}

export function StreamingBubble({ content }: StreamingBubbleProps) {
	// Defensive: content from the hook is already stripped, but strip again so a
	// raw marker can never leak if this component is fed unstripped text.
	const safe = stripStreamingMarkers(content);
	return (
		<div className="flex gap-3 py-1.5">
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				{safe ? (
					<div className="prose">
						<Streamdown mode="streaming">{safe}</Streamdown>
					</div>
				) : (
					<div className="flex items-center gap-1 py-2">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
						<span
							className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
							style={{ animationDelay: "0.15s" }}
						/>
						<span
							className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
							style={{ animationDelay: "0.3s" }}
						/>
					</div>
				)}
				<span className="inline-block h-4 w-0.5 animate-pulse bg-neutral-400" />
			</div>
		</div>
	);
}
