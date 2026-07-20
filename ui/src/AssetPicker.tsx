// Asset-insertion dialog for the canvas — three tabs (Icons via Iconify, Logos via
// SVGL, GIFs via the host/Core proxy). Ported from the desktop AssetPicker, but
// self-contained (plain markup + canvas.css). Icons/logos are fetched DIRECTLY from
// the frame under the app's per-app CSP allowlist; GIFs go through the host bridge
// (Core proxy holds the provider key). Returns an AssetSelection the board turns
// into an upload node.

import { useCallback, useEffect, useState } from "react";
import {
	type AssetSelection,
	fetchIconSvg,
	fetchSvgText,
	type IconHit,
	type LogoHit,
	searchGifs,
	searchIcons,
	searchLogos,
} from "./bridge";
import type { RyuGif } from "./ryu";

type AssetTab = "icons" | "logos" | "gifs";

const PLACEHOLDER: Record<AssetTab, string> = {
	icons: "Search icons (Lucide, Hugeicons, and more)…",
	logos: "Search brand logos…",
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

	if (!open) {
		return null;
	}

	return (
		<button
			aria-label="Close asset picker"
			className="cv-modal-backdrop"
			onClick={onClose}
			type="button"
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: stop-propagation shell */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop handles keys */}
			<div
				className="cv-modal"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
			>
				<div className="cv-modal-head">
					<span className="cv-modal-title">Insert asset</span>
					<button
						aria-label="Close"
						className="cv-del"
						onClick={onClose}
						type="button"
					>
						✕
					</button>
				</div>
				<div className="cv-tabs">
					{(["icons", "logos", "gifs"] as AssetTab[]).map((t) => (
						<button
							className="cv-tab-pill"
							data-active={tab === t ? "1" : "0"}
							key={t}
							onClick={() => setTab(t)}
							type="button"
						>
							{t === "icons" ? "Icons" : t === "logos" ? "Logos" : "GIFs"}
						</button>
					))}
				</div>
				<input
					// biome-ignore lint/a11y/noAutofocus: search-first dialog
					autoFocus
					className="cv-modal-search"
					onChange={(e) => setQuery(e.target.value)}
					placeholder={PLACEHOLDER[tab]}
					value={query}
				/>
				<div className="cv-modal-body">
					{loading ? (
						<div className="cv-modal-empty">
							<span className="cv-spinner" />
						</div>
					) : error ? (
						<div className="cv-modal-empty">{error}</div>
					) : tab === "icons" ? (
						icons.length === 0 ? (
							<div className="cv-modal-empty">No icons found.</div>
						) : (
							<div className="cv-asset-grid cv-asset-grid-8">
								{icons.map((hit) => (
									<button
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
									</button>
								))}
							</div>
						)
					) : tab === "logos" ? (
						logos.length === 0 ? (
							<div className="cv-modal-empty">No logos found.</div>
						) : (
							<div className="cv-asset-grid cv-asset-grid-6">
								{logos.map((hit) => (
									<button
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
									</button>
								))}
							</div>
						)
					) : gifConfigured ? (
						gifs.length === 0 ? (
							<div className="cv-modal-empty">No GIFs found.</div>
						) : (
							<div className="cv-asset-grid cv-asset-grid-4">
								{gifs.map((hit) => (
									<button
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
									</button>
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
			</div>
		</button>
	);
}
