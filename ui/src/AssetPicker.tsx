// Asset-insertion dialog for the canvas — searchable icons, logos, Openverse, Unsplash,
// and GIFs. Ported from the desktop AssetPicker, but
// composed with Ryu dialog and control primitives. Icons/logos are fetched from
// the frame under the app's per-app CSP allowlist; GIFs go through the host bridge
// (Core proxy holds the provider key). Returns an AssetSelection the board turns
// into an upload node.

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
	Spinner,
} from "@ryu/blocks/companion/controls";
import { useCallback, useEffect, useState } from "react";
import {
	type AssetSelection,
	fetchIconSvg,
	fetchSvgText,
	type IconHit,
	type LogoHit,
	searchGifs,
	searchIcons,
	searchImages,
	searchLogos,
} from "./bridge";
import type { RyuGif } from "./ryu";

type AssetTab = "icons" | "logos" | "openverse" | "unsplash" | "gifs";

const PLACEHOLDER: Record<AssetTab, string> = {
	icons: "Search icons (Lucide, Hugeicons, and more)…",
	logos: "Search brand logos…",
	openverse: "Search Openverse images…",
	unsplash: "Search Unsplash photos…",
	gifs: "Search GIFs…",
};

export function AssetPicker({
	open,
	onClose,
	onSelect,
}: {
	open: boolean;
	onClose: () => void;
	onSelect: (selection: AssetSelection) => void;
}) {
	const [tab, setTab] = useState<AssetTab>("icons");
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [icons, setIcons] = useState<IconHit[]>([]);
	const [logos, setLogos] = useState<LogoHit[]>([]);
	const [images, setImages] = useState<
		Awaited<ReturnType<typeof searchImages>>["results"]
	>([]);
	const [imageConfigured, setImageConfigured] = useState(true);
	const [gifs, setGifs] = useState<RyuGif[]>([]);
	const [gifConfigured, setGifConfigured] = useState(true);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(query), 300);
		return () => clearTimeout(t);
	}, [query]);

	useEffect(() => {
		if (open) {
			setQuery("");
			setDebounced("");
			setError(null);
		}
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		const run = async () => {
			try {
				if (tab === "icons") {
					const hits = await searchIcons(debounced);
					if (!cancelled) {
						setIcons(hits);
					}
				} else if (tab === "logos") {
					const hits = await searchLogos(debounced);
					if (!cancelled) {
						setLogos(hits);
					}
				} else if (tab === "openverse" || tab === "unsplash") {
					const resp = await searchImages(tab, debounced);
					if (!cancelled) {
						setImages(resp.results);
						setImageConfigured(resp.configured);
					}
				} else {
					const resp = await searchGifs(debounced);
					if (!cancelled) {
						setGifs(resp.results);
						setGifConfigured(resp.configured);
					}
				}
			} catch {
				if (!cancelled) {
					setError(
						"Couldn't load results. Check your connection and try again."
					);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};
		run();
		return () => {
			cancelled = true;
		};
	}, [open, tab, debounced]);

	const pickIcon = useCallback(
		async (hit: IconHit) => {
			try {
				const svg = await fetchIconSvg(hit.id);
				onSelect({ kind: "svg", svg, name: hit.id });
				onClose();
			} catch {
				setError("Couldn't load that icon. Try another.");
			}
		},
		[onSelect, onClose]
	);

	const pickLogo = useCallback(
		async (hit: LogoHit) => {
			try {
				const svg = await fetchSvgText(hit.svgUrl);
				onSelect({ kind: "svg", svg, name: hit.title });
				onClose();
			} catch {
				setError("Couldn't load that logo. Try another.");
			}
		},
		[onSelect, onClose]
	);

	const pickGif = useCallback(
		(hit: RyuGif) => {
			onSelect({
				kind: "gif",
				url: hit.url,
				name: hit.title,
				width: hit.width,
				height: hit.height,
			});
			onClose();
		},
		[onSelect, onClose]
	);

	const pickImage = useCallback(
		(hit: (typeof images)[number]) => {
			onSelect({
				kind: "image",
				dataUrl: hit.url,
				name: hit.title,
				width: hit.width,
				height: hit.height,
				attribution: hit.attribution,
				sourceUrl: hit.sourceUrl,
				rights: hit.rights,
			});
			onClose();
		},
		[images, onSelect, onClose]
	);

	if (!open) {
		return null;
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
			open={open}
		>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Insert asset</DialogTitle>
					<DialogDescription>
						Find an icon, logo, or GIF for your canvas.
					</DialogDescription>
				</DialogHeader>
				<div className="cv-tabs">
					{(
						["icons", "logos", "openverse", "unsplash", "gifs"] as AssetTab[]
					).map((t) => (
						<Button
							className="cv-tab-pill"
							data-active={tab === t ? "1" : "0"}
							key={t}
							onClick={() => setTab(t)}
							type="button"
						>
							{t === "icons"
								? "Icons"
								: t === "logos"
									? "Logos"
									: t === "openverse"
										? "Openverse"
										: t === "unsplash"
											? "Unsplash"
											: "GIFs"}
						</Button>
					))}
				</div>
				<Input
					aria-label="Search assets"
					onChange={(e) => setQuery(e.target.value)}
					placeholder={PLACEHOLDER[tab]}
					value={query}
				/>
				<div className="cv-modal-body">
					{loading ? (
						<div className="cv-modal-empty">
							<Spinner />
						</div>
					) : error ? (
						<div className="cv-modal-empty">{error}</div>
					) : tab === "icons" ? (
						icons.length === 0 ? (
							<div className="cv-modal-empty">No icons found.</div>
						) : (
							<div className="cv-asset-grid cv-asset-grid-8">
								{icons.map((hit) => (
									<Button
										className="cv-asset-tile"
										key={hit.id}
										onClick={() => pickIcon(hit)}
										title={hit.id}
										type="button"
									>
										<img
											alt={hit.id}
											className="cv-asset-icon"
											loading="lazy"
											src={hit.previewUrl}
										/>
									</Button>
								))}
							</div>
						)
					) : tab === "logos" ? (
						logos.length === 0 ? (
							<div className="cv-modal-empty">No logos found.</div>
						) : (
							<div className="cv-asset-grid cv-asset-grid-6">
								{logos.map((hit) => (
									<Button
										className="cv-asset-tile"
										key={hit.svgUrl}
										onClick={() => pickLogo(hit)}
										title={hit.title}
										type="button"
									>
										<img
											alt={hit.title}
											className="cv-asset-logo"
											loading="lazy"
											src={hit.svgUrl}
										/>
									</Button>
								))}
							</div>
						)
					) : tab === "openverse" || tab === "unsplash" ? (
						imageConfigured ? (
							images.length === 0 ? (
								<div className="cv-modal-empty">No images found.</div>
							) : (
								<div className="cv-asset-grid cv-asset-grid-4">
									{images.map((hit) => (
										<Button
											className="cv-asset-tile cv-asset-tile-gif"
											key={hit.id}
											onClick={() => pickImage(hit)}
											title={`${hit.title} — ${hit.attribution}`}
											type="button"
										>
											<img
												alt={hit.title}
												className="cv-asset-gif"
												loading="lazy"
												src={hit.preview}
											/>
											<span className="sr-only">{hit.attribution}</span>
										</Button>
									))}
								</div>
							)
						) : (
							<div className="cv-modal-empty">
								Unsplash search needs a node Unsplash access key. Openverse
								works without provider setup.
							</div>
						)
					) : gifConfigured ? (
						gifs.length === 0 ? (
							<div className="cv-modal-empty">No GIFs found.</div>
						) : (
							<div className="cv-asset-grid cv-asset-grid-4">
								{gifs.map((hit) => (
									<Button
										className="cv-asset-tile cv-asset-tile-gif"
										key={hit.id}
										onClick={() => pickGif(hit)}
										title={hit.title}
										type="button"
									>
										<img
											alt={hit.title}
											className="cv-asset-gif"
											loading="lazy"
											src={hit.preview}
										/>
									</Button>
								))}
							</div>
						)
					) : (
						<div className="cv-modal-empty">
							GIF search needs a free API key on this node (Settings → set
							gif-api-key). Icons and logos work with no setup.
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
