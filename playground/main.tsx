import "@/editor.css";
import "@/styles/content.css";

import { RichTextEditor } from "@/RichTextEditor";
import { defineRichTextEditorElement } from "@/element";
import api from "@/mount";
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

const SAMPLE = `<h1 style="text-align: center">Project Proposal</h1>
<p><strong>Client:</strong> Acme Ltd&nbsp;&nbsp;&nbsp;&nbsp;<strong>Date:</strong> 26 September 2026</p>
<table border="1" style="border-collapse: collapse; width: 100%">
  <tr><td><strong>Item</strong></td><td><strong>Detail</strong></td></tr>
  <tr><td>Scope</td><td>Design, build and launch.</td></tr>
  <tr><td>Timeline</td><td>Twelve weeks from sign-off.</td></tr>
</table>
<ul><li>Paste from Word to see tables, fonts and spacing survive.</li><li>Try Tab in the middle of a line.</li></ul>`;

// Tabs
const tabs = document.querySelectorAll<HTMLButtonElement>("[data-tab]");
tabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll<HTMLElement>("main > section").forEach((s) => {
      s.hidden = s.id !== `tab-${tab.dataset.tab}`;
    });
  })
);

// 1. React component
const reactOut = document.getElementById("react-out")!;
const reactJson = document.getElementById("react-json")!;
const renderOut = document.getElementById("render-out")!;
function show(html: string, value?: unknown) {
  reactOut.textContent = html;
  if (value) reactJson.textContent = JSON.stringify(value, null, 2);
  renderOut.innerHTML = html;
}
show(SAMPLE);

function ReactDemo() {
  const [, setHtml] = useState(SAMPLE);
  return (
    <RichTextEditor
      initialHtml={SAMPLE}
      minHeight={360}
      onChange={({ html, value }) => {
        setHtml(html);
        show(html, value);
      }}
    />
  );
}
createRoot(document.getElementById("react-root")!).render(
  <StrictMode>
    <ReactDemo />
  </StrictMode>
);

// 2. Custom element
defineRichTextEditorElement();
const elementForm = document.getElementById("element-form") as HTMLFormElement;
elementForm.addEventListener("submit", (e) => {
  e.preventDefault();
  document.getElementById("element-out")!.textContent = String(
    new FormData(elementForm).get("body")
  );
});

// 3. Mount API
const mountOut = document.getElementById("mount-out")!;
const textarea = document.getElementById("mount-body") as HTMLTextAreaElement;
api.mount("#mount-editor", { textarea, minHeight: 240 });
mountOut.textContent = textarea.value;
document.getElementById("mount-get")!.addEventListener("click", () => {
  mountOut.textContent = api.getHtml("#mount-editor");
});
document.getElementById("mount-set")!.addEventListener("click", () => {
  api.setHtml("#mount-editor", SAMPLE);
  mountOut.textContent = api.getHtml("#mount-editor");
});
