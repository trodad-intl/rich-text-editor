/**
 * Mount API for pages that are not React apps — server-rendered forms, PHP
 * templates, Rails, Django, plain HTML.
 *
 * React is an ISLAND here: it owns the inside of one <div> and nothing else.
 * The page's own scripts, CSS and ordinary form POST are untouched — the
 * editor's only job is to keep a hidden <textarea> filled with HTML, so the
 * server receives the document as a normal form field.
 */
import {
  RichTextEditor,
  type RichTextEditorHandle,
  type RichTextEditorProps,
} from "./RichTextEditor";
import { csrfFromMeta, serializeForForm, withCsrf, type DocumentFormat } from "./form-support";
import type { Value } from "platejs";
import React, { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface MountOptions
  extends Omit<
    RichTextEditorProps,
    "initialHtml" | "initialValue" | "onChange" | "onChangeHtml" | "onChangeValue"
  > {
  /** The <textarea> (usually hidden) that carries the document to the server. */
  textarea: string | HTMLTextAreaElement;
  /**
   * What the textarea holds, both on load and on save: HTML (default) or the
   * Plate value as JSON.
   */
  format?: DocumentFormat;
  /**
   * Added to Word-import requests as `csrfHeader`. Defaults to the page's
   * `<meta name="csrf-token">` (the Rails / PHP-framework convention).
   */
  csrfToken?: string;
  /** Header name for `csrfToken`. Default "X-CSRF-TOKEN". */
  csrfHeader?: string;
  /** Called with both formats after every change (debounced), after the textarea is updated. */
  onChange?: RichTextEditorProps["onChange"];
}

interface Instance {
  root: Root;
  handle: React.RefObject<RichTextEditorHandle | null>;
  container: Element;
  form: HTMLFormElement | null;
  onSubmit?: (e: Event) => void;
}

const instances = new Map<Element, Instance>();

function resolve<T extends Element>(target: string | T): T | null {
  return typeof target === "string" ? document.querySelector<T>(target) : target;
}

function mount(selector: string | Element, options: MountOptions) {
  const container = resolve(selector as string);
  if (!container) {
    console.error("[rich-text-editor] mount target not found:", selector);
    return null;
  }
  if (instances.has(container)) return instances.get(container)!.handle;

  const textarea = resolve(options.textarea as string) as HTMLTextAreaElement | null;
  if (!textarea) {
    console.error("[rich-text-editor] textarea not found:", options.textarea);
    return null;
  }

  const handle = createRef<RichTextEditorHandle>();
  const root = createRoot(container);

  const { textarea: _t, format = "html", csrfToken, csrfHeader, onChange, wordImport, ...props } =
    options;
  const initial = textarea.value || "";

  root.render(
    <RichTextEditor
      {...props}
      ref={handle}
      initialHtml={format === "html" ? initial : undefined}
      initialValue={format === "json" ? initial : undefined}
      wordImport={withCsrf(wordImport ?? {}, csrfToken ?? csrfFromMeta(), csrfHeader)}
      onChange={(change) => {
        textarea.value = serializeForForm(format, change.html, change.value);
        onChange?.(change);
      }}
    />
  );

  // Force a serialize before the POST.
  //
  // The editor publishes on a 250ms debounce, so clicking Create within a
  // quarter-second of the last keystroke would otherwise post slightly stale
  // HTML. Capture phase, because a jQuery-triggered submit still dispatches a
  // real DOM event but listeners on the form itself may stopPropagation.
  const form = textarea.closest("form");
  const onSubmit = () => {
    handle.current?.flush();
  };
  form?.addEventListener("submit", onSubmit, { capture: true });

  const instance: Instance = { root, handle, container, form, onSubmit };
  instances.set(container, instance);
  return handle;
}

function destroy(selector: string | Element) {
  const container = resolve(selector as string);
  if (!container) return;
  const instance = instances.get(container);
  if (!instance) return;
  if (instance.form && instance.onSubmit) {
    instance.form.removeEventListener("submit", instance.onSubmit, { capture: true });
  }
  instance.root.unmount();
  instances.delete(container);
}

/** Serialize now and return the HTML — useful for custom submit flows. */
function getHtml(selector: string | Element): string {
  const container = resolve(selector as string);
  if (!container) return "";
  return instances.get(container)?.handle.current?.getHtml() ?? "";
}

/** The current Plate document. */
function getValue(selector: string | Element): Value | null {
  const container = resolve(selector as string);
  if (!container) return null;
  return instances.get(container)?.handle.current?.getValue() ?? null;
}

/** Replace the document with a Plate value (or its JSON string). */
function setValue(selector: string | Element, value: Value | string) {
  const container = resolve(selector as string);
  if (!container) return;
  instances.get(container)?.handle.current?.setValue(value);
}

/** Replace the document with HTML. */
function setHtml(selector: string | Element, html: string) {
  const container = resolve(selector as string);
  if (!container) return;
  instances.get(container)?.handle.current?.setHtml(html);
}

export { mount, destroy, getHtml, setHtml, getValue, setValue };

export interface MountApi {
  mount: typeof mount;
  destroy: typeof destroy;
  getHtml: typeof getHtml;
  setHtml: typeof setHtml;
  getValue: typeof getValue;
  setValue: typeof setValue;
}

const api: MountApi = { mount, destroy, getHtml, setHtml, getValue, setValue };

export default api;
