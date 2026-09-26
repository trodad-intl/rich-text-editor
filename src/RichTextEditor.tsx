import { AlignToolbarButton } from "./components/ui/align-toolbar-button";
import { Editor, EditorContainer } from "./components/ui/editor";
import { FixedToolbar } from "./components/ui/fixed-toolbar";
import { FontColorToolbarButton } from "./components/ui/font-color-toolbar-button";
import { FontSizeToolbarButton } from "./components/ui/font-size-toolbar-button";
import { RedoToolbarButton, UndoToolbarButton } from "./components/ui/history-toolbar-button";
import { InsertToolbarButton } from "./components/ui/insert-toolbar-button";
import { LineHeightToolbarButton } from "./components/ui/line-height-toolbar-button";
import { LinkToolbarButton } from "./components/ui/link-toolbar-button";
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
} from "./components/ui/list-toolbar-button";
import { MarkToolbarButton } from "./components/ui/mark-toolbar-button";
import { MediaToolbarButton } from "./components/ui/media-toolbar-button";
import { TableToolbarButton } from "./components/ui/table-toolbar-button";
import { ToolbarGroup } from "./components/ui/toolbar";
import { TurnIntoToolbarButton } from "./components/ui/turn-into-toolbar-button";
import {
  WordImportToolbarButton,
  type WordImportOptions,
} from "./components/word-import-toolbar-button";
import { deserializeDocument, initialDocument, parseValue } from "./lib/document";
import { plateValueToHtml } from "./lib/html-serializer";
import { cn } from "./lib/utils";
import { buildPlugins, type PasteMode } from "./plugins";
import { FontFamilyPlugin } from "@platejs/basic-styles/react";
import {
  BaselineIcon,
  BoldIcon,
  ItalicIcon,
  PaintBucketIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "lucide-react";
import { KEYS, type Value } from "platejs";
import { Plate, useEditorRef, usePlateEditor, type PlateEditor } from "platejs/react";
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";

export interface FontFamilyOption {
  /** Shown in the picker. */
  label: string;
  /** A CSS `font-family` value. Empty string means "no font set" (inherit). */
  value: string;
}

/** The font picker's default entries. Override with the `fontFamilies` prop. */
export const DEFAULT_FONT_FAMILIES: FontFamilyOption[] = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Calibri", value: "Calibri, Carlito, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
];

/**
 * How long the editor sits on a change before reporting it.
 *
 * This is a LAG, not merely a throttle: anything typed inside this window is
 * not yet in what the last change callback carried. `flush()` exists for
 * exactly that reason, and the form integrations (mount, the custom element)
 * call it on submit.
 */
const PUBLISH_DEBOUNCE_MS = 250;

/** What the change callback receives: the document in both formats. */
export interface RichTextChange {
  /** Self-contained, inline-styled HTML — see the README's "HTML it produces". */
  html: string;
  /** The Plate document (JSON-serializable). */
  value: Value;
}

export interface RichTextEditorProps {
  /**
   * Document to open with, as HTML. HTML from other editors, Word and
   * LibreOffice is accepted. Read once, when the editor is created.
   */
  initialHtml?: string;
  /**
   * Document to open with, as a Plate value or its JSON string. Takes
   * precedence over `initialHtml`. Read once, when the editor is created.
   */
  initialValue?: Value | string;
  /** Receives both formats after every change (debounced 250ms). */
  onChange?: (change: RichTextChange) => void;
  /** Receives HTML after every change (debounced 250ms). */
  onChangeHtml?: (html: string) => void;
  /** Receives the Plate value after every change (debounced 250ms). */
  onChangeValue?: (value: Value) => void;
  placeholder?: string;
  /** Minimum height of the editable area, in px. Default 600. */
  minHeight?: number;
  /**
   * "clean" (default) normalizes pasted content: Word's margins and
   * letter/word-spacing are dropped, and font sizes and line heights are
   * snapped onto the scales the editor's own controls use.
   * "faithful" keeps every value exactly as the source stated it.
   */
  pasteMode?: PasteMode;
  /** Font picker entries. Pass `[]` to hide the picker. */
  fontFamilies?: FontFamilyOption[];
  /**
   * Word (.doc/.docx) import. By default a .docx is converted in the browser;
   * give `url` or `convert` for server-side conversion (needed for .doc).
   * `false` removes the button.
   */
  wordImport?: WordImportOptions | false;
  /** Render the document without editing or a toolbar. */
  readOnly?: boolean;
  /** Show the toolbar. Default true (always hidden when `readOnly`). */
  toolbar?: boolean;
  /** Browser spell checking in the editable. Default true. */
  spellCheck?: boolean;
  /** Class for the outer frame. */
  className?: string;
}

export interface RichTextEditorHandle {
  /**
   * Serialize now, bypassing the debounce, fire the change callbacks, and
   * return the HTML. Call it before submitting.
   */
  flush: () => string;
  getHtml: () => string;
  setHtml: (html: string) => void;
  /** The current Plate document. */
  getValue: () => Value;
  /** Replace the document with a Plate value (or its JSON string). */
  setValue: (value: Value | string) => void;
  focus: () => void;
  /** The underlying Plate editor, for advanced integrations. */
  getEditor: () => PlateEditor | null;
}

/**
 * Memoised, so it renders once and stays put: the toolbar's ~20 buttons must
 * not re-render on every keystroke. Each button holds its own subscription to
 * the marks it reflects, so they still light up on selection.
 */
const EditorToolbar = React.memo(function EditorToolbar({
  fontFamilies,
  wordImport,
}: {
  fontFamilies: FontFamilyOption[];
  wordImport: WordImportOptions | false;
}) {
  const editor = useEditorRef();

  const setFontFamily = useCallback(
    (value: string) => {
      if (value) {
        editor.tf.addMark(FontFamilyPlugin.key, value);
      } else {
        editor.tf.removeMark(FontFamilyPlugin.key);
      }
      editor.tf.focus();
    },
    [editor]
  );

  return (
    <div className="flex flex-wrap gap-0 p-0">
      <ToolbarGroup>
        <UndoToolbarButton />
        <RedoToolbarButton />
      </ToolbarGroup>

      <ToolbarGroup>
        <InsertToolbarButton />
        <TurnIntoToolbarButton />
        {fontFamilies.length > 0 && (
          <select
            aria-label="Font"
            className="border-input bg-background text-foreground focus:ring-ring h-7 rounded-md border px-2 text-xs outline-none focus:ring-1"
            onChange={(e) => setFontFamily(e.target.value)}
            defaultValue=""
          >
            {fontFamilies.map((font) => (
              <option key={font.value} value={font.value} style={{ fontFamily: font.value || "inherit" }}>
                {font.label}
              </option>
            ))}
          </select>
        )}
        <FontSizeToolbarButton />
      </ToolbarGroup>

      <ToolbarGroup>
        <MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold (Ctrl+B)">
          <BoldIcon className="size-3" />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic (Ctrl+I)">
          <ItalicIcon className="size-3" />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.underline} tooltip="Underline (Ctrl+U)">
          <UnderlineIcon className="size-3" />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType={KEYS.strikethrough} tooltip="Strikethrough">
          <StrikethroughIcon className="size-3" />
        </MarkToolbarButton>
        <FontColorToolbarButton nodeType={KEYS.color} tooltip="Text color">
          <BaselineIcon className="size-3" />
        </FontColorToolbarButton>
        <FontColorToolbarButton nodeType={KEYS.backgroundColor} tooltip="Background color">
          <PaintBucketIcon className="size-3" />
        </FontColorToolbarButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <AlignToolbarButton />
        <LineHeightToolbarButton />
        <NumberedListToolbarButton />
        <BulletedListToolbarButton />
      </ToolbarGroup>

      <ToolbarGroup>
        <LinkToolbarButton />
        <TableToolbarButton />
        <MediaToolbarButton nodeType={KEYS.img} />
      </ToolbarGroup>

      {wordImport !== false && (
        <ToolbarGroup>
          <WordImportToolbarButton {...wordImport} />
        </ToolbarGroup>
      )}
    </div>
  );
});

export type { PasteMode };

export const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      initialHtml = "",
      initialValue,
      onChange,
      onChangeHtml,
      onChangeValue,
      placeholder = "Start typing…",
      minHeight = 600,
      pasteMode = "clean",
      fontFamilies = DEFAULT_FONT_FAMILIES,
      wordImport = {},
      readOnly = false,
      toolbar = true,
      spellCheck = true,
      className,
    },
    ref
  ) {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbacks = useRef({ onChange, onChangeHtml, onChangeValue });
    callbacks.current = { onChange, onChangeHtml, onChangeValue };

    const plugins = useMemo(() => buildPlugins(pasteMode), [pasteMode]);

    // Cast: `enabled` is never passed, so an editor is always created.
    const editor = usePlateEditor({
      plugins,
      // HTML is deserialized through Plate's OWN pipeline — the same one that
      // handles a Word paste — rather than a hand-written parser, after the
      // passes in `prepareHtml` that Plate's deserializer does not do itself.
      value: (ed) => initialDocument(ed, initialHtml, initialValue),
    }) as PlateEditor;

    const serialize = useCallback(
      (): string => plateValueToHtml(editor.children as Value),
      [editor]
    );

    /** Serialize and hand both formats to whichever callbacks are set. */
    const publish = useCallback((): string => {
      const html = serialize();
      const value = editor.children as Value;
      const { onChange: all, onChangeHtml: toHtml, onChangeValue: toValue } = callbacks.current;
      toHtml?.(html);
      toValue?.(value);
      all?.({ html, value });
      return html;
    }, [editor, serialize]);

    const handleChange = useCallback(
      ({ editor: changed }: { editor: PlateEditor; value: Value }) => {
        // Moving the caret is not a change to the document and must not start
        // the timer: re-rendering inside slate-react's 100ms throttled
        // selection commit drags the caret back to the line just left.
        const ops = changed?.operations;
        if (ops?.length && ops.every((op) => op.type === "set_selection")) return;

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(publish, PUBLISH_DEBOUNCE_MS);
      },
      [publish]
    );

    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        flush: () => {
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
          }
          return publish();
        },
        getHtml: () => serialize(),
        setHtml: (html: string) => {
          editor.tf.setValue(deserializeDocument(editor, html));
          publish();
        },
        getValue: () => editor.children as Value,
        setValue: (value: Value | string) => {
          editor.tf.setValue(parseValue(editor, value));
          publish();
        },
        focus: () => editor.tf.focus(),
        getEditor: () => editor,
      }),
      [editor, publish, serialize]
    );

    return (
      <div
        className={cn("bg-background flex w-full flex-col overflow-clip rounded-md border", className)}
      >
        <Plate editor={editor} onChange={handleChange} readOnly={readOnly}>
          {toolbar && !readOnly && (
            <FixedToolbar className="border-border bg-muted/30 border-b">
              <EditorToolbar fontFamilies={fontFamilies} wordImport={wordImport} />
            </FixedToolbar>
          )}
          <EditorContainer style={{ minHeight }}>
            {/*
              The min-height belongs on the EDITABLE too, not only on the box
              around it. The editable is as tall as its content, so on a short
              document it covered ~50px of a 600px frame and every click in the
              space below it landed on the container: no focus, no caret, and
              typing went nowhere. Sized like this the editable fills the frame,
              so a click anywhere in it puts the caret on the nearest line.
            */}
            <Editor
              variant="document"
              // A tab is as wide as the distance to the next tab stop, and that
              // distance is `tab-size` — 8 spaces, as in word processors, print
              // and PDF renderers. Tailwind's preflight sets 4 here, so pasted
              // columns lined up one way on screen and another way on paper.
              className="[tab-size:8]"
              placeholder={placeholder}
              spellCheck={spellCheck}
              readOnly={readOnly}
              style={{ minHeight }}
            />
          </EditorContainer>
        </Plate>
      </div>
    );
  }
);

export default RichTextEditor;
