// Canvas app entry. Mounts the React board into the `#ryu-plugin-root` div the
// host document provides. The `window.ryu` bridge is installed inline by the Path
// B host bootstrap (injected into <head>) BEFORE this module runs, so the board's
// first effect can call `window.ryu.spaces.getDoc` (queued until the host port
// arrives).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import { Canvas } from "./Canvas";
import "./canvas.css";

const container = document.getElementById("ryu-plugin-root");
if (container) {
	createRoot(container).render(
		<StrictMode>
			<Canvas />
		</StrictMode>
	);
}
