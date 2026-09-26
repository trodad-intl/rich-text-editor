# Migrating from the RadioLens / MediSpa editor build

This package began as the report editor inside the RadioLens and MediSpa
Laravel apps (`resources/js/editor`, branch `ristech-editor-maintenance`). If
you are replacing that in-app build:

| Before | Now |
| --- | --- |
| Vite entry `resources/js/editor/entry.tsx` | `dist/standalone/rich-text-editor.js` + `dist/rich-text-editor.bootstrap.css` |
| `window.RadiolensEditor.mount(sel, { textarea, docConvertUrl })` | `window.TrodadRichTextEditor.mount(sel, { textarea, wordImport: { url } })` |
| `<textarea hidden>` + `<div class="rl-editor-scope">` + inline mount script | `<trodad-rich-text-editor name="report_body">{{ $body }}</trodad-rich-text-editor>` (or keep mounting) |
| `RadiolensEditor` React component, `docConvertUrl`, `csrfToken` props | `RichTextEditor`, `wordImport={{ url, headers }}` |
| CSS scope class `rl-editor-scope` | `rte-scope` |
| `_partials/radiolens_report_body_styles.blade.php` + `class="rl-report-body"` | `dist/content.css` + `class="rte-content"` |
| `fitReportTablesToPage()` inline on the print page | `TrodadRichTextEditor.fitTablesToPage({ selector: '.main_data table' })` |
| Menus at z-index 20050 | Default 50; set `:root { --rte-popover-z-index: 20050; }` on the admin panel |
| Placeholder "Type the report here…" | Default "Start typing…"; pass `placeholder` |
| Font list from the Summernote build | Generic list; pass `fontFamilies` to restore Calibri / Arial Narrow / Arial Unicode MS |
| Spell check off | On by default; pass `spellCheck={false}` / keep the old behaviour by setting it |

The stored HTML format is unchanged, so existing report bodies open as before.
The Word conversion route (`DocToHtmlController`) is reusable as-is. A copy is
in `examples/laravel`.
