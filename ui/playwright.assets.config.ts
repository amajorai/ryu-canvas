import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";
export default defineConfig({
	...base,
	use: { ...base.use, baseURL: "http://127.0.0.1:58439", trace: "off" },
	webServer: {
		command: "bunx vite --host 127.0.0.1 --port 58439 --strictPort",
		cwd: import.meta.dirname,
		url: "http://127.0.0.1:58439",
		reuseExistingServer: false,
	},
	outputDir: path.resolve(import.meta.dirname, "test-results-assets"),
});
