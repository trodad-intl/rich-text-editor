"use client";

import { IndentPlugin } from "@platejs/indent/react";
import { KEYS } from "platejs";

export const IndentKit = [
  IndentPlugin.configure({
    inject: {
      targetPlugins: [
        ...KEYS.heading,
        KEYS.p,
        KEYS.blockquote,
        KEYS.codeBlock,
        KEYS.toggle,
        KEYS.img,
      ],
    },
    options: {
      /**
       * One indent level, in px — and it has to be the SERIALIZER's number.
       *
       * `blockStyle` writes `margin-left: indent * 36pt` (lib/html-serializer.ts),
       * which is 48px: half an inch, Word's indent step and the editable's
       * `tab-size`. On that grid a tab in an indented line lands on the stop
       * Word puts it on; at 40px it landed 40px further along. This is only
       * what the editor DRAWS, and at 24 it drew every indent a little under
       * two-thirds of the width the same document printed at.
       */
      offset: 48,
    },
  }),
];
