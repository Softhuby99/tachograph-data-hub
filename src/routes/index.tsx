import { createFileRoute } from "@tanstack/react-router";
import { TachographTool } from "@/components/tacho/TachographTool";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tachograph Cards Info Tool" },
      {
        name: "description",
        content:
          "Consolidated overview of all European tachograph cards (G1, G2.1, G2.2): manufacturers, chip platforms, certificates and procurement data.",
      },
      { property: "og:title", content: "Tachograph Cards Info Tool" },
      {
        property: "og:description",
        content: "Search European tachograph cards by country, generation and manufacturer.",
      },
    ],
  }),
  component: TachographTool,
});
