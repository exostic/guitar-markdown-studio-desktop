import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// GitHub Pages serves project pages under /<repo-name>/, so the Pages build
// sets GMS_BASE_PATH to that prefix. The Electron desktop build loads dist/
// via a file:// URL instead, so it must keep the default root base.

// public/llms.txt is the syntax reference written for AI agents. Besides being
// served as /llms.txt, it is inlined into index.html at build time so that an
// agent fetching the site root (without running JavaScript) gets the whole
// reference on its first request instead of an empty application shell.
// The section is hidden by a stylesheet rule on purpose: readability-style
// extractors drop `hidden` attributes and inline display:none, but keep
// content hidden through a class.
const llmsTxtPath = fileURLToPath(new URL("./public/llms.txt", import.meta.url));

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineAgentReference() {
  return {
    name: "gms-inline-agent-reference",
    transformIndexHtml(html) {
      const reference = readFileSync(llmsTxtPath, "utf8");
      return html.replace(
        "<!-- agent-reference -->",
        `<section class="agent-reference" data-source="llms.txt">\n<pre>${escapeHtml(reference)}</pre>\n</section>`,
      );
    },
  };
}

export default defineConfig({
  base: process.env.GMS_BASE_PATH || "/",
  plugins: [inlineAgentReference()],
});
