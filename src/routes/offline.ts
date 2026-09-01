import { createFileRoute } from "@tanstack/react-router";
// Bundled at build time — serves the standalone (offline/Electron) app
// in the browser as a preview, with the card data already injected.
import standaloneHtml from "../../standalone/index.html?raw";
import standaloneData from "../../standalone/data.json?raw";

export const Route = createFileRoute("/offline")({
  server: {
    handlers: {
      GET: async () => {
        const html = standaloneHtml.replace("__DATA__", standaloneData);
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  },
});
