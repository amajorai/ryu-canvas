const ELEMENTS = new Set([
	"svg",
	"g",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"defs",
	"linearGradient",
	"radialGradient",
	"stop",
	"clipPath",
	"mask",
	"title",
	"desc",
	"text",
	"tspan",
]);
const MAX_BYTES = 1_000_000;
/** Decode an inert image and retain only pixels; never insert SVG into the DOM. */
export async function rasterizeSvg(svg: string): Promise<string> {
	if (svg.length > MAX_BYTES || /<!DOCTYPE|<!ENTITY/iu.test(svg)) {
		throw new Error("Unsupported SVG asset.");
	}
	const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
	const root = parsed.documentElement;
	if (root.localName !== "svg" || parsed.querySelector("parsererror")) {
		throw new Error("Invalid SVG asset.");
	}
	for (const element of [root, ...root.querySelectorAll("*")]) {
		if (
			!ELEMENTS.has(element.localName) ||
			element.namespaceURI !== "http://www.w3.org/2000/svg"
		) {
			throw new Error("Unsupported SVG content.");
		}
		for (const attribute of element.attributes) {
			const name = attribute.localName.toLowerCase();
			const value = attribute.value.trim();
			if (
				name.startsWith("on") ||
				name === "style" ||
				name === "base" ||
				(name === "href" && !/^#[\w.-]+$/u.test(value)) ||
				(/url\s*\(/iu.test(value) && !/^url\(\s*#[\w.-]+\s*\)$/u.test(value))
			) {
				throw new Error(
					"SVG external resources and scripts are not supported."
				);
			}
		}
	}
	root.setAttribute("width", "512");
	root.setAttribute("height", "512");
	const source = new XMLSerializer().serializeToString(root);
	const image = new Image();
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("SVG decoding timed out.")),
			5000
		);
		image.onload = () => {
			clearTimeout(timeout);
			resolve();
		};
		image.onerror = () => {
			clearTimeout(timeout);
			reject(new Error("Invalid SVG image."));
		};
		image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`;
	});
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Image conversion is unavailable.");
	}
	context.drawImage(image, 0, 0, 512, 512);
	return canvas.toDataURL("image/png");
}
export function storedSvg(value: string | undefined): string | null {
	const prefix = "data:image/svg+xml;base64,";
	if (!value?.startsWith(prefix) || value.length > MAX_BYTES * 2) {
		return null;
	}
	try {
		return decodeURIComponent(escape(atob(value.slice(prefix.length))));
	} catch {
		return null;
	}
}
