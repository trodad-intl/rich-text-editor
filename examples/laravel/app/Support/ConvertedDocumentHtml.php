<?php

namespace App\Support;

/**
 * Makes LibreOffice's converted HTML self-contained.
 *
 * `soffice --convert-to html` does not embed pictures. It writes each one
 * BESIDE the HTML as its own file and points at it relatively —
 * `<img src="img_html_642c3933.png">` — and the conversion workspace is a
 * temporary directory deleted the moment the request ends. So by the time the
 * editor is handed that markup the file behind every image is already gone, and
 * a document imported with a picture in it arrives with a dead frame where the
 * picture should be.
 *
 * Inlining is not a workaround here, it is the representation the editor
 * already uses: a picture dropped into the editor by hand is stored as a data
 * URL too (src/hooks/use-base64-upload.ts in the package), and the stored
 * document is a single HTML string with nowhere else to put a file.
 */
class ConvertedDocumentHtml
{
    /**
     * Pictures a Word document can carry, and what each is served as.
     *
     * A deliberate allow-list rather than a MIME sniff: whatever is inlined
     * here ends up in a `src` the browser will execute a renderer over, and
     * only these belong in a document.
     */
    private const IMAGE_TYPES = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'bmp' => 'image/bmp',
        'webp' => 'image/webp',
    ];

    /**
     * The largest single picture to inline.
     *
     * Base64 costs a third more than the bytes it encodes, and the result is
     * stored in the document's column — so one phone photo pasted into a Word
     * file would otherwise arrive as a 10MB row. Anything larger is left as the
     * reference it is: a picture that does not load, rather than a save that
     * does not fit.
     */
    private const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

    /**
     * The same HTML with every picture the converter wrote beside it inlined as
     * a data URL.
     */
    public static function inlineImages(string $html, string $workspace): string
    {
        $replaced = preg_replace_callback(
            '/\bsrc\s*=\s*(["\'])(?<src>[^"\']*)\1/i',
            static function (array $match) use ($workspace): string {
                $uri = self::dataUri($match['src'], $workspace);

                return $uri === null ? $match[0] : 'src="'.$uri.'"';
            },
            $html
        );

        return $replaced ?? $html;
    }

    /** The referenced file as a data URL, or null to leave the reference alone. */
    private static function dataUri(string $src, string $workspace): ?string
    {
        // Already self-contained, or fetched over the network by the browser.
        if ($src === '' || preg_match('#^(data:|https?:|//|file:)#i', $src) === 1) {
            return null;
        }

        $root = realpath($workspace);
        if ($root === false) {
            return null;
        }

        // Resolved rather than trusted: the path comes out of a converted
        // document, and `../../../etc/passwd` must read nothing.
        $path = realpath($root.'/'.rawurldecode($src));
        if ($path === false || ! str_starts_with($path, $root.DIRECTORY_SEPARATOR)) {
            return null;
        }

        $mime = self::IMAGE_TYPES[strtolower(pathinfo($path, PATHINFO_EXTENSION))] ?? null;
        if ($mime === null || ! is_file($path)) {
            return null;
        }

        $size = filesize($path);
        if ($size === false || $size === 0 || $size > self::MAX_IMAGE_BYTES) {
            return null;
        }

        $bytes = file_get_contents($path);

        return $bytes === false ? null : 'data:'.$mime.';base64,'.base64_encode($bytes);
    }
}
