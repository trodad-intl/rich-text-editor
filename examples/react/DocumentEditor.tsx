/**
 * React example: controlled HTML state, flush before save, and loading a
 * different document without remounting.
 */
import { RichTextEditor, type RichTextEditorHandle } from "@trodad/rich-text-editor";
import "@trodad/rich-text-editor/style.css";
import { useRef, useState } from "react";

export function DocumentEditor({
  initialHtml,
  templates,
  onSave,
}: {
  initialHtml: string;
  templates: { name: string; html: string }[];
  onSave: (html: string) => Promise<void>;
}) {
  const editor = useRef<RichTextEditorHandle>(null);
  const [dirty, setDirty] = useState(false);

  return (
    <div>
      <select
        defaultValue=""
        onChange={(e) => {
          const t = templates.find((t) => t.name === e.target.value);
          if (t) editor.current?.setHtml(t.html);
        }}
      >
        <option value="" disabled>
          Load a template…
        </option>
        {templates.map((t) => (
          <option key={t.name}>{t.name}</option>
        ))}
      </select>

      <RichTextEditor
        ref={editor}
        initialHtml={initialHtml}
        onChangeHtml={() => setDirty(true)}
        minHeight={500}
      />

      <button
        disabled={!dirty}
        onClick={async () => {
          await onSave(editor.current!.flush());
          setDirty(false);
        }}
      >
        Save
      </button>
    </div>
  );
}
