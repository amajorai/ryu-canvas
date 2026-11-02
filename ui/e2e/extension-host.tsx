import { APP_DOWNLOAD_GRANT, ExtensionHost } from "@ryu/app-host/ExtensionHost";
import { capabilitiesFromGrants, type HostServices } from "@ryu/app-host/rpc";
import { htmlCompanionSrcdoc } from "@ryu/app-host/third-party-plugin";
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import manifest from "../../manifest.json" with { type: "json" };
import appHtml from "../dist/index.html?raw";
import "./extension-host.css";

interface HostCall {
	input:
		| Parameters<NonNullable<HostServices["spacesGetDoc"]>>[0]
		| Parameters<NonNullable<HostServices["spacesUpdateDoc"]>>[0]
		| Parameters<NonNullable<HostServices["generateImage"]>>[0];
	method: string;
}

interface HostFixture {
	calls: HostCall[];
	doc: { id: string; kind: string; source: string; title: string };
	generatedImage: string;
}

declare global {
	interface Window {
		__canvasHostFixture: HostFixture;
	}
}

const DOC_ID = "canvas-extension-host-doc";
const SPACE_ID = "canvas-extension-host-space";
const imageCanvas = document.createElement("canvas");
imageCanvas.width = 64;
imageCanvas.height = 40;
const imageContext = imageCanvas.getContext("2d");
if (!imageContext) {
	throw new Error("Canvas ExtensionHost fixture could not create its PNG.");
}
imageContext.fillStyle = "#d97706";
imageContext.fillRect(0, 0, imageCanvas.width, imageCanvas.height);

const fixture: HostFixture = {
	calls: [],
	doc: {
		id: DOC_ID,
		kind: "canvas",
		source: "",
		title: "ExtensionHost board",
	},
	generatedImage: imageCanvas.toDataURL("image/png"),
};

function recordCall(method: string, input: HostCall["input"]): void {
	fixture.calls.push({ input: structuredClone(input), method });
}

const services: HostServices = {
	listAgents: async () => [],
	registerRoute: async () => {
		throw new Error("Canvas fixture does not provide route registration.");
	},
	spacesGetDoc: async (input) => {
		recordCall("spaces.getDoc", input);
		return structuredClone(fixture.doc);
	},
	spacesUpdateDoc: async (input) => {
		recordCall("spaces.updateDoc", input);
		fixture.doc = {
			...fixture.doc,
			source: input.source,
			title: input.title ?? fixture.doc.title,
		};
	},
	generateImage: async (input) => {
		recordCall("media.image", input);
		return [fixture.generatedImage];
	},
};

Object.assign(window, { __canvasHostFixture: fixture });

function ProductHost() {
	const nonce = useMemo(() => crypto.randomUUID(), []);
	const srcdoc = useMemo(
		() =>
			htmlCompanionSrcdoc(nonce, appHtml, manifest.id, {
				docId: DOC_ID,
				spaceId: SPACE_ID,
			}),
		[nonce]
	);
	const approvedGrants = manifest.permission_grants;
	const granted = useMemo(
		() => capabilitiesFromGrants(approvedGrants),
		[approvedGrants]
	);
	return (
		<main className="canvas-extension-host-proof">
			<p className="canvas-extension-host-proof__banner">
				Shipped Canvas bundle in ExtensionHost · local Space and media services
			</p>
			<ExtensionHost
				allowDownloads={approvedGrants.includes(APP_DOWNLOAD_GRANT)}
				granted={granted}
				nonce={nonce}
				services={services}
				srcdoc={srcdoc}
				title="Canvas"
			/>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<ProductHost />);
}
