import { createSlatePlugin, KEYS, type Descendant, type Value } from "platejs";

import { openBreakOnlyLines } from "../lib/break-only-lines";

/**
 * A pasted `<p><br></p>` is one blank line, as it is in the document it came
 * from. Hooks the HTML plugin's `transformFragment`, the paste's one seam after
 * deserializing; opening a document and the Word import run the same pass
 * themselves. See lib/break-only-lines.ts.
 */
export const BreakOnlyLinePlugin = createSlatePlugin({
  key: "breakOnlyLine",
  inject: {
    plugins: {
      [KEYS.html]: {
        parser: {
          transformFragment: ({ fragment }: { fragment: Descendant[] }) =>
            openBreakOnlyLines(fragment as Value),
        },
      },
    },
  },
});
