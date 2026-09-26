# @trodad/rich-text-editor

A rich text editor that reads and writes **self-contained HTML or Plate JSON**, and takes a paste from **Word, Excel or LibreOffice** without losing tables, fonts, colours or spacing.

It is built for documents that must look the same everywhere they end up: on screen, printed, as a PDF and in an email. Under the hood it is [Plate](https://platejs.org) (Slate + React), with about 25 custom plugins that handle Word's markup faithfully.

It works in two kinds of app:

- **React apps**, as a component.
- **Server-rendered pages** (Laravel Blade, Rails, Django, plain HTML), as an HTML tag with no build step and no JavaScript to write.

```html
<trodad-rich-text-editor name="body">{{ $post->body }}</trodad-rich-text-editor>
```

---

## Contents

- [Features](#features)
- [Install](#install)
- [Usage](#usage)
  - [React](#react)
  - [Next.js](#nextjs)
  - [Laravel Blade and other server-rendered pages](#laravel-blade-and-other-server-rendered-pages)
- [Showing saved HTML (read-only, print, PDF)](#showing-saved-html-read-only-print-pdf)
- [Stylesheets and theming](#stylesheets-and-theming)
- [Word import](#word-import)
- [API reference](#api-reference)
- [The HTML it produces](#the-html-it-produces)
- [Bundle size](#bundle-size)
- [Browser support](#browser-support)
- [Development](#development)

---

## Features

- **HTML or JSON, your choice.** Load and save as inline-styled HTML, which renders the same in a browser, a print view, dompdf or an email with no stylesheet, or as the Plate document (JSON). Or keep both: every change reports both formats.
- **Faithful paste from Word, Excel and LibreOffice.** It keeps:
  - table column widths, borders, padding, shading and vertical alignment
  - merged cells
  - font families and point sizes
  - text and background colours
  - paragraph and line spacing
  - text boxes, bordered paragraphs, tabs and non-breaking spaces
  - pictures, including ones Word only exposes through RTF
- **Two paste modes.**
  - `clean` (default) snaps pasted sizes and spacing onto the editor's own scales and drops stray margins.
  - `faithful` keeps every value exactly as the source stated it.
- **Tables you can shape.** Drag column and row borders, and set borders, padding and backgrounds per cell. Borderless tables show editing guides that never print.
- **Tab inserts a tab at the caret**, like a word processor, instead of indenting the whole line. List items still nest, and Shift+Tab still outdents.
- **Word import button** for `.docx` (converted in the browser) and `.doc` (through your server; see [Word import](#word-import)).
- **Print parity.** `content.css` renders saved HTML with the editor's exact metrics, and `fitTablesToPage()` shrinks wide tables to the paper width.
- **Styles that don't leak.** Every rule is scoped to the editor, so it can be dropped into an existing app (including a Bootstrap 5 one) without restyling the host page.
- **Tested in a real browser.** Playwright suites measure the real layout (column widths after a drag, line boxes, font metrics, print parity), alongside about 400 unit tests.

## Install

```bash
pnpm add @trodad/rich-text-editor
# or: npm install @trodad/rich-text-editor
```

React 18 or 19 is a peer dependency when you use the component. The standalone build for server-rendered pages bundles its own copy of React.

## Usage

### React

```tsx
import { RichTextEditor, type RichTextEditorHandle } from "@trodad/rich-text-editor";
import "@trodad/rich-text-editor/style.css";
import { useRef } from "react";

export function PostForm({ post }: { post: { html: string } }) {
  const editor = useRef<RichTextEditorHandle>(null);

  async function save() {
    // flush() serializes immediately, skipping the 250ms change debounce, so a
    // save clicked straight after typing never sends stale content.
    const html = editor.current!.flush();
    await fetch("/api/posts", { method: "POST", body: JSON.stringify({ html }) });
  }

  return (
    <>
      <RichTextEditor ref={editor} initialHtml={post.html} minHeight={500} />
      <button onClick={save}>Save</button>
    </>
  );
}
```

#### HTML, JSON, or both

Open from either format. Every change reports both, so you can store whichever you need:

```tsx
<RichTextEditor
  initialValue={post.json}   // a Plate value, or its JSON string, straight from the database
  // initialHtml={post.html} // …or HTML. initialValue wins if both are given.
  onChange={({ html, value }) => save({ html, json: value })}
  // or just one: onChangeHtml={(html) => …} / onChangeValue={(value) => …}
/>
```

The ref has `getHtml()` / `setHtml(html)` and `getValue()` / `setValue(value)`. To convert without an editor on screen, use `htmlToValue(html)` and `valueToHtml(value)`.

`initialHtml` and `initialValue` are read **once**, when the editor is created. To load a different document later, call `setHtml` / `setValue`, or remount with a new `key`.

### Next.js

Everything the package exports is marked `"use client"`. The editor measures fonts and layout in the DOM, so render it on the client only:

```tsx
// app/components/editor.tsx
"use client";
import dynamic from "next/dynamic";
import "@trodad/rich-text-editor/style.css";

export const RichTextEditor = dynamic(
  () => import("@trodad/rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false, loading: () => <div style={{ minHeight: 500 }} /> }
);
```

### Laravel Blade and other server-rendered pages

No npm, bundler or React on your side. Serve two files from the package's `dist/`, by copying them into `public/` or from a CDN such as jsDelivr or unpkg once the package is published there:

- `dist/standalone/`, the script and the chunks it lazy-loads; copy the whole folder
- `dist/rich-text-editor.css`, or `rich-text-editor.bootstrap.css` on a Bootstrap 5 page

```blade
<head>
  <meta name="csrf-token" content="{{ csrf_token() }}">  {{-- optional; sent with Word-import requests --}}
  <link rel="stylesheet" href="{{ asset('vendor/rich-text-editor/rich-text-editor.bootstrap.css') }}">
  <script type="module" src="{{ asset('vendor/rich-text-editor/standalone/rich-text-editor.js') }}"></script>
</head>
```

#### Option 1: the HTML element (recommended)

```blade
<form method="POST" action="{{ route('posts.store') }}">
  @csrf
  <trodad-rich-text-editor
      name="body"
      min-height="500"
      placeholder="Write something…">{{ old('body', $post->body) }}</trodad-rich-text-editor>

  <button type="submit">Save</button>
</form>
```

Add `format="json"` to store the Plate document instead: the element then reads its content as JSON and posts JSON.

The element is a real form field:

- The document is posted as `body`.
- `form.reset()` restores the original document.
- `new FormData(form)` includes it.
- Validation redirects work through `old()`.

The stored HTML goes **inside the tag, escaped**. `{{ }}` escaping is exactly right, because the element reads its text content back as the original HTML string. Do not use `{!! !!}` here.

In browsers without form-associated custom elements (Safari before 16.4), the element keeps a hidden `<textarea name="…">` beside itself, so the form posts the same way.

#### Option 2: mount onto an existing textarea

Use this when a page already has a hidden textarea (for example, replacing Summernote or TinyMCE):

```blade
<textarea name="body" id="body" hidden>{{ $post->body }}</textarea>
<div id="body_editor"></div>

<script type="module">
  TrodadRichTextEditor.mount("#body_editor", {
    textarea: "#body",
    minHeight: 500,
    // format: "json",                       // store the Plate document instead of HTML
    // wordImport: { url: "/convert-word" }, // server-side Word conversion
  });
</script>
```

The textarea is kept filled with the document and flushed on submit. `getHtml`, `setHtml`, `getValue`, `setValue` and `destroy` (each taking the selector) are also available.

## Showing saved HTML (read-only, print, PDF)

The saved HTML carries its own inline styles, so it displays reasonably anywhere. To render it **exactly** as the editor drew it (the same base size, line boxes, table layout and list indents), wrap it in `.rte-content` and load `content.css` **after** your page's own CSS:

```blade
<link rel="stylesheet" href="{{ asset('vendor/rich-text-editor/content.css') }}">

<div class="rte-content">{!! $post->body !!}</div>
```

> **Sanitize untrusted HTML.** The editor does not sanitize, and neither does `content.css`. If the HTML can come from anyone other than a trusted author, pass it through a sanitizer before echoing it raw (for example [HTML Purifier](http://htmlpurifier.org/) in PHP, or [DOMPurify](https://github.com/cure53/DOMPurify) / [sanitize-html](https://github.com/apostrophecms/sanitize-html) in JS). Allow inline `style`, `colgroup`/`col`, and `colspan`/`rowspan`, or the formatting is lost.

### Printing wide tables

Tables are laid out with fixed pixel widths, so a table drawn wider than the paper would be cut off. Call this just before printing:

```ts
import { fitTablesToPage } from "@trodad/rich-text-editor";

fitTablesToPage();                        // tables inside .rte-content, A4 width
fitTablesToPage({ printableWidth: 720 }); // another paper size or margin
```

It is also available on the standalone global, as `TrodadRichTextEditor.fitTablesToPage()`. Tables that already fit are left untouched. Wider ones keep the author's proportions, re-expressed as percentages of the page.

## Stylesheets and theming

| Import | Use it when |
| --- | --- |
| `@trodad/rich-text-editor/style.css` | Any app. The editor UI, scoped to `.rte-scope`. |
| `@trodad/rich-text-editor/style.bootstrap.css` | The page loads Bootstrap 5. Same as above, plus overrides for the utility class names Bootstrap also defines and marks `!important` (`.p-0`, `.table`, …). |
| `@trodad/rich-text-editor/content.css` | Showing saved HTML read-only (see above). |

Load **one** of the first two. Their rules only apply inside `.rte-scope`, which the editor, the custom element and every popup menu carry, so the host page's headings, lists and tables are never touched.

**Theme tokens.** The editor uses shadcn-style CSS variables. Override them on the scope:

```css
.rte-scope {
  --primary: hsl(160 84% 30%);
  --ring: hsl(160 84% 30%);
  --radius: 0.375rem;
  /* also: --background --foreground --popover --muted --accent --border --input
     --highlight --brand and their *-foreground pairs */
}
```

**Menu stacking.** Toolbar menus are portalled to `<body>` at `z-index: 50`. If your app has fixed chrome stacked higher (a sidebar, a header, a modal), raise it:

```css
:root { --rte-popover-z-index: 1100; }
```

## Word import

The toolbar's Word button accepts `.docx` and `.doc`:

- **`.docx`** is converted **in the browser** with [mammoth](https://github.com/mwilliamson/mammoth.js), loaded on first use. No server is needed, but mammoth keeps the structure and drops most direct formatting (colours, sizes, alignment).
- **`.doc`** (the old binary format), and `.docx` at full fidelity, need a server-side converter. Give one through the `wordImport` option:

```tsx
// Your own converter: anything that turns a File into HTML.
<RichTextEditor wordImport={{ convert: async (file) => myConvert(file) }} />

// Or an endpoint, with whatever headers it needs.
<RichTextEditor wordImport={{ url: "/api/convert-word", headers: { Authorization: `Bearer ${token}` } }} />

// Or no button at all.
<RichTextEditor wordImport={false} />
```

When a server conversion fails, a `.docx` falls back to the browser conversion.

The endpoint contract:

```
POST <url>
Content-Type: multipart/form-data    (the file, under fieldName: default "file")

200 → { "html": "<p>…</p>" }
4xx → { "message": "Why it failed" }
```

A reliable implementation runs LibreOffice headless (`soffice --headless --convert-to html`), takes the `<body>` of the result, and inlines its images as `data:` URLs. [`examples/laravel`](examples/laravel) has a complete one.

On server-rendered pages, the element and `mount()` add the page's `<meta name="csrf-token">` (the Laravel and Rails convention) to the request as `X-CSRF-TOKEN` automatically. Override the token or header with `csrf-token` / `csrf-header` (element) or `csrfToken` / `csrfHeader` (mount).

## API reference

### `<RichTextEditor>` props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `initialHtml` | `string` | `""` | Document to open, as HTML. HTML from other editors, Word and LibreOffice is accepted. Read once. |
| `initialValue` | `Value \| string` | | Document to open, as a Plate value or its JSON string. Wins over `initialHtml`. Read once. |
| `onChange` | `({ html, value }) => void` | | Both formats after each change, debounced 250ms. Moving the caret is not a change. |
| `onChangeHtml` | `(html: string) => void` | | HTML only. |
| `onChangeValue` | `(value: Value) => void` | | Plate value only. |
| `placeholder` | `string` | `"Start typing…"` | |
| `minHeight` | `number` | `600` | Minimum height of the editable area, in px. |
| `pasteMode` | `"clean" \| "faithful"` | `"clean"` | See [Features](#features). |
| `fontFamilies` | `{ label, value }[]` | `DEFAULT_FONT_FAMILIES` | Font picker entries. `[]` hides the picker. |
| `wordImport` | `WordImportOptions \| false` | `{}` | See [Word import](#word-import). |
| `readOnly` | `boolean` | `false` | Show the document without editing or a toolbar. |
| `toolbar` | `boolean` | `true` | |
| `spellCheck` | `boolean` | `true` | |
| `className` | `string` | | Class for the outer frame. |

### `RichTextEditorHandle` (ref)

| Method | |
| --- | --- |
| `flush(): string` | Serialize now, skipping the debounce, fire the change callbacks, and return the HTML. Call it before submitting. |
| `getHtml(): string` / `setHtml(html)` | Read or replace the document as HTML. |
| `getValue(): Value` / `setValue(value)` | Read or replace the document as a Plate value (`setValue` also takes a JSON string). |
| `focus(): void` | |
| `getEditor(): PlateEditor \| null` | The underlying Plate editor, for advanced integrations. |

### `<trodad-rich-text-editor>`

| Attribute | |
| --- | --- |
| `name` | Form field name. |
| `format` | `html` (default) or `json`: what the initial content is, and what is posted. |
| `value` | Initial document, as an alternative to the text content. |
| `placeholder`, `min-height`, `paste-mode` | As the props above. |
| `read-only` | Boolean attribute. |
| `toolbar="false"` | Hide the toolbar. |
| `word-import="false"` | Remove the Word button. |
| `word-import-url` | Server conversion endpoint. |
| `csrf-token`, `csrf-header` | Sent with the Word-import request. The defaults are `<meta name="csrf-token">` and `X-CSRF-TOKEN`. |

- **Properties:** `value` (a string in the element's format), `format`, `form`, `name`, `editor`.
- **Methods:** `getHtml()`, `setHtml(html)`, `getValue()`, `setValue(value)`, `flush()`, `focus()`.
- **Events:** `input` after each (debounced) change, and `change` when focus leaves the editor.

In a bundled app, register the element with your own React:

```ts
import "@trodad/rich-text-editor/element";
import "@trodad/rich-text-editor/style.css";
```

### `mount` API

```ts
import { mount, getHtml, setHtml, getValue, setValue, destroy } from "@trodad/rich-text-editor/mount";

mount(target: string | Element, {
  textarea: string | HTMLTextAreaElement, // kept filled with the document
  format?: "html" | "json",               // what the textarea holds; default "html"
  csrfToken?, csrfHeader?,                // for Word-import requests
  onChange?,                              // ({ html, value }) after the textarea is updated
  ...any <RichTextEditor> prop except initial*/onChange*
}): RefObject<RichTextEditorHandle> | null;
```

The standalone script exposes the same functions on `window.TrodadRichTextEditor`, plus `fitTablesToPage`, `htmlToValue` and `valueToHtml`.

### Other exports

- `htmlToValue(html)`: HTML to a Plate value, exactly as the editor would open it. Browser only.
- `valueToHtml(value)`: a Plate value (or its JSON) to the editor's HTML.
- `buildPlugins(pasteMode)`: the editor's full plugin list, for building your own Plate editor.
- `DEFAULT_FONT_FAMILIES`, `EMPTY_VALUE`, `isPlateValueEmpty`, and the `Value` type.

### Package entry points

| Entry | Contents |
| --- | --- |
| `@trodad/rich-text-editor` | React component, converters, print helper. Dependencies are external. |
| `@trodad/rich-text-editor/element` | Registers `<trodad-rich-text-editor>` with your React. |
| `@trodad/rich-text-editor/mount` | `mount` and friends, with your React. |
| `@trodad/rich-text-editor/standalone` | Self-contained ES module with React included. Registers the element and the globals. |
| `…/style.css`, `…/style.bootstrap.css`, `…/content.css` | See [Stylesheets](#stylesheets-and-theming). |

## The HTML it produces

The output is designed to be stored as-is and rendered by anything:

- Paragraphs are `<p>`. An empty line is `<p><br/></p>`.
- Block formatting is inline `style`: `text-align`, `margin-left` (40px per indent level), `line-height`, `margin-top`/`margin-bottom`, `font-size` and `background-color`.
- Runs are `<strong>`, `<em>`, `<u>`, `<s>`, `<sub>`, `<sup>`, `<code>` and `<mark>`, plus `<span style>` for colour, background, size and font family.
- Tabs and runs of spaces are kept as `<span style="white-space: pre">`.
- Tables are `<table border style="border-collapse: collapse; width: …">`, with a `<colgroup>` of column widths and per-cell borders, padding, background, width and vertical alignment.
- Images are `<img style="max-width: 100%; height: auto">`, wrapped in a `<figure>` with a `<figcaption>` when captioned. Pasted and uploaded pictures are embedded as `data:` URLs.
- Lists are `<ul>` or `<ol>` with nested lists inside the `<li>`. The list style type and start number are kept.

## Bundle size

- **Library build** (`@trodad/rich-text-editor`): about 275 kB of editor code, plus Plate, Slate and Radix from your own `node_modules`. Your bundler shares them with anything else that uses them.
- **Standalone build:** about 550 kB gzipped, with React included. mammoth, for browser-side Word import, is a separate 130 kB (gzipped) chunk that only loads when someone imports a `.docx`.

A large part of either is what makes pasting from Word faithful: `@platejs/juice` and its HTML parser inline Word's stylesheet onto each element, so a paste keeps its fonts, sizes and colours.

## Browser support

- Current Chrome, Edge, Firefox and Safari.
- The standalone build is an ES module (`<script type="module">`).
- Form association uses `ElementInternals`, with a hidden-field fallback for older browsers.

## Development

```bash
pnpm install
pnpm exec playwright install chromium   # once

pnpm dev          # playground at http://localhost:5173, served from src/ with hot reload
pnpm build        # dist/: library, standalone bundle, stylesheets, type declarations
pnpm test:unit    # vitest + jsdom
pnpm test:browser # Playwright, against the built dist/ (run pnpm build first)
pnpm test         # both
pnpm typecheck
```

### Contributing and releases

Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`…). PRs are squash-merged into `main`. [release-please](https://github.com/googleapis/release-please) keeps a release PR open with the next version and changelog, and merging it publishes the package to npm with provenance.

**Why two test suites.** jsdom does no layout, since `getBoundingClientRect()` is all zeros there. So anything about widths, drags, line boxes, fonts or print parity is tested in Playwright against the **built** package, in the most demanding configuration it ships (the Bootstrap-hardened stylesheet on a Bootstrap 5 page). Everything else is unit-tested. `PW_CHANNEL=chrome pnpm test:browser` runs the browser suite in installed Google Chrome instead of Playwright's Chromium.

```
src/
  RichTextEditor.tsx       the React component
  element.tsx              <trodad-rich-text-editor>
  mount.tsx                mount API for non-React pages
  standalone.ts            script-tag entry (bundles React)
  plugins.ts               ordered plugin list; order matters for paste transforms
  lib/                     pure HTML transforms: serializer, Word/LibreOffice paste recovery, table widths, font sizes
  components/              Plate plugin kits and the custom plugins
  components/ui/           toolbar, node renderers, shadcn primitives
  print/                   fitTablesToPage
  styles/content.css   read-only rendering
  editor.css               Tailwind entry for the editor UI
build/
  build-css.mjs            builds the three stylesheets
  scope-editor-css.mjs     re-roots every rule under .rte-scope
tests/unit/                vitest
tests/browser/             Playwright specs + harness
tests/fixtures/            Bootstrap 5.0.2 and a real host print page
playground/                pnpm dev
```

The code comments explain *why* things are the way they are, usually with the bug that forced it. Read them before changing a transform.

## License

[MIT](LICENSE) © Trodad
