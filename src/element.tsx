/**
 * `<trodad-rich-text-editor>` — the editor as a plain HTML form control.
 *
 * For server-rendered pages that should not have to write any JavaScript:
 *
 *   <form method="POST" action="/posts">
 *     <trodad-rich-text-editor name="body" min-height="500">
 *       {{ $post->body }}
 *     </trodad-rich-text-editor>
 *     <button>Save</button>
 *   </form>
 *
 * The element is FORM-ASSOCIATED (ElementInternals), so it takes part in the
 * form exactly like a <textarea>: the document is posted under `name`,
 * `form.reset()` restores the initial document, and `new FormData(form)` sees
 * it. Where the browser has no form-associated custom elements (Safari before
 * 16.4), it keeps a hidden <textarea name> beside itself instead, so the form
 * posts the same.
 *
 * The initial document is the element's TEXT content, so a template engine's
 * ordinary escaping output (`<%= %>` in ERB, `{{ }}` in Jinja/Django/Twig,
 * `htmlspecialchars()` in PHP) is exactly right: the escaped markup reads back as the original
 * string. It can also be given as a `value` attribute or property.
 *
 * `format="json"` makes both the initial document and the posted value a Plate
 * value serialized as JSON instead of HTML.
 *
 * Attributes: name, value, format ("html" | "json"), placeholder, min-height,
 * paste-mode ("clean" | "faithful"), read-only, toolbar ("false" hides it),
 * word-import ("false" removes the button), word-import-url, csrf-token
 * (defaults to <meta name="csrf-token">), csrf-header (default X-CSRF-TOKEN).
 *
 * Events: `input` on every (debounced) change, `change` when focus leaves.
 */
import React, { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Value } from "platejs";
import { RichTextEditor, type PasteMode, type RichTextEditorHandle } from "./RichTextEditor";
import { csrfFromMeta, serializeForForm, withCsrf, type DocumentFormat } from "./form-support";

export const TAG_NAME = "trodad-rich-text-editor";

/** Scope class every editor style is confined to; see build/scope-editor-css.mjs. */
const SCOPE_CLASS = "rte-scope";

export class RichTextEditorElement extends HTMLElement {
  static formAssociated = true;

  static get observedAttributes() {
    return [
      "placeholder",
      "min-height",
      "paste-mode",
      "read-only",
      "toolbar",
      "word-import",
      "word-import-url",
      "csrf-token",
      "csrf-header",
    ];
  }

  #internals: ElementInternals | null;
  /** Fallback form field, only where ElementInternals cannot carry a value. */
  #field: HTMLTextAreaElement | null = null;
  #form: HTMLFormElement | null = null;
  #root: Root | null = null;
  #handle = createRef<RichTextEditorHandle>();
  #value = "";
  #initialValue = "";
  #onSubmit = () => this.flush();

  constructor() {
    super();
    const internals = typeof this.attachInternals === "function" ? this.attachInternals() : null;
    this.#internals = typeof internals?.setFormValue === "function" ? internals : null;
  }

  #setFormValue(html: string) {
    if (this.#internals) {
      this.#internals.setFormValue(html);
      return;
    }
    const name = this.getAttribute("name");
    if (!name) return;
    if (!this.#field) {
      this.#field = document.createElement("textarea");
      this.#field.hidden = true;
      this.#field.setAttribute("data-rich-text-editor-field", "");
    }
    this.#field.name = name;
    this.#field.value = html;
    if (this.isConnected && this.nextSibling !== this.#field) this.after(this.#field);
  }

  /** "html" (default) or "json" — what `value` and the posted field hold. */
  get format(): DocumentFormat {
    return this.getAttribute("format") === "json" ? "json" : "html";
  }

  /**
   * The current document in the element's `format`: HTML, or the Plate value
   * as a JSON string. Setting it replaces the document.
   */
  get value(): string {
    const handle = this.#handle.current;
    if (!handle) return this.#value;
    return this.format === "json" ? JSON.stringify(handle.getValue()) : handle.getHtml();
  }

  set value(next: string) {
    this.#value = next ?? "";
    this.#setFormValue(this.#value);
    const handle = this.#handle.current;
    if (!handle) return;
    if (this.format === "json") handle.setValue(this.#value);
    else handle.setHtml(this.#value);
  }

  /** The current document as HTML, whatever the format. */
  getHtml(): string {
    return this.#handle.current?.getHtml() ?? (this.format === "html" ? this.#value : "");
  }

  /** Replace the document with HTML, whatever the format. */
  setHtml(html: string): void {
    this.#handle.current?.setHtml(html);
  }

  /** The current Plate document, whatever the format. */
  getValue(): Value | null {
    return this.#handle.current?.getValue() ?? null;
  }

  /** Replace the document with a Plate value (or its JSON string). */
  setValue(value: Value | string): void {
    this.#handle.current?.setValue(value);
  }

  get name(): string | null {
    return this.getAttribute("name");
  }

  get form(): HTMLFormElement | null {
    return this.#internals?.form ?? this.closest("form");
  }

  /**
   * Serialize now, bypassing the debounce, update the form value, and return
   * it (in the element's `format`).
   */
  flush(): string {
    // flush() fires onChange, which stores the value and updates the form.
    this.#handle.current?.flush();
    return this.#value;
  }

  focus(): void {
    this.#handle.current?.focus();
  }

  /** The underlying Plate editor, for advanced integrations. */
  get editor() {
    return this.#handle.current?.getEditor() ?? null;
  }

  connectedCallback() {
    if (!this.#root) {
      // Read the initial document BEFORE React takes the element over.
      this.#initialValue = this.getAttribute("value") ?? (this.textContent ?? "").trim();
      this.#value = this.#initialValue;

      this.textContent = "";
      this.classList.add(SCOPE_CLASS);
      if (!this.style.display) this.style.display = "block";

      this.#root = createRoot(this);
      this.#render();
    }
    // Also on a MOVE, which disconnects and reconnects: the form may be another
    // one now, and the fallback field has to follow the element.
    this.#setFormValue(this.#value);

    // The editor publishes on a debounce; a submit inside that window must not
    // post stale HTML. Capture phase so a handler that stops propagation on the
    // form cannot skip it.
    this.#form = this.form;
    this.#form?.addEventListener("submit", this.#onSubmit, { capture: true });
    this.addEventListener("focusout", this.#onFocusOut);
  }

  disconnectedCallback() {
    this.#form?.removeEventListener("submit", this.#onSubmit, { capture: true });
    this.#form = null;
    this.removeEventListener("focusout", this.#onFocusOut);
    // Unmount after the current task: a node that is only being MOVED is
    // disconnected and reconnected synchronously, and must keep its editor.
    const root = this.#root;
    queueMicrotask(() => {
      if (!this.isConnected && root === this.#root) {
        root?.unmount();
        this.#root = null;
        this.#field?.remove();
      }
    });
  }

  attributeChangedCallback() {
    if (this.#root) this.#render();
  }

  formResetCallback() {
    this.value = this.#initialValue;
  }

  formDisabledCallback(disabled: boolean) {
    this.toggleAttribute("aria-disabled", disabled);
  }

  #onFocusOut = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && this.contains(e.relatedTarget)) return;
    this.dispatchEvent(new Event("change", { bubbles: true }));
  };

  #render() {
    const minHeight = Number(this.getAttribute("min-height"));
    const format = this.format;
    const wordImportUrl = this.getAttribute("word-import-url");
    const wordImport =
      this.getAttribute("word-import") === "false"
        ? false
        : withCsrf(
            wordImportUrl ? { url: wordImportUrl } : {},
            this.getAttribute("csrf-token") ?? csrfFromMeta(),
            this.getAttribute("csrf-header") ?? undefined
          );

    this.#root!.render(
      <RichTextEditor
        ref={this.#handle}
        initialHtml={format === "html" ? this.#value : undefined}
        initialValue={format === "json" ? this.#value : undefined}
        onChange={({ html, value }) => {
          this.#value = serializeForForm(format, html, value);
          this.#setFormValue(this.#value);
          this.dispatchEvent(new Event("input", { bubbles: true }));
        }}
        placeholder={this.getAttribute("placeholder") ?? undefined}
        minHeight={Number.isFinite(minHeight) && minHeight > 0 ? minHeight : undefined}
        pasteMode={(this.getAttribute("paste-mode") as PasteMode | null) ?? undefined}
        readOnly={this.hasAttribute("read-only")}
        toolbar={this.getAttribute("toolbar") !== "false"}
        wordImport={wordImport}
      />
    );
  }
}

/** Register the element. Safe to call more than once. */
export function defineRichTextEditorElement(tagName: string = TAG_NAME): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(tagName)) customElements.define(tagName, RichTextEditorElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "trodad-rich-text-editor": RichTextEditorElement;
  }
}
