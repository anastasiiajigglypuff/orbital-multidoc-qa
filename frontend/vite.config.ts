import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		host: "0.0.0.0",
		// The Docker volume mount (colima/virtiofs) doesn't propagate inotify
		// events, so file edits don't hot-reload without polling.
		watch: {
			usePolling: true,
			interval: 300,
		},
		proxy: {
			"/api": {
				target: "http://backend:8000",
				changeOrigin: true,
			},
		},
	},
});
