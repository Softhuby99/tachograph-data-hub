import { createFileRoute } from "@tanstack/react-router";
// Bundled at build time — serves the standalone (offline/Electron) app
// in the browser as a preview, with the card data already injected.
import standaloneHtml from "../../standalone/index.html?raw";
import standaloneData from "../../standalone/data.json?raw";

export const Route = createFileRoute("/offline")({
  server: {
    handlers: {
      GET: async () => {
        // v2.49: the data sits inside a <script> element. "</script>" inside a
        // JSON string would end that element early, so every "<" is written as
        // its JSON escape (same value once parsed). The replacement is passed as
        // a function so "$&" / "$'" in the data are not treated as patterns.
        const safeData = standaloneData
          .replace(/</g, "\\u003c")
          .replace(/\u2028/g, "\\u2028")
          .replace(/\u2029/g, "\\u2029");
        const html = standaloneHtml.replace("__DATA__", () => safeData);
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  },
});
