<?php

namespace App\Http\Controllers\Tools;

use App\Http\Controllers\Controller;
use App\Support\ConvertedDocumentHtml;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

class DocToHtmlController extends Controller
{
    /**
     * Convert an uploaded Word file (.doc or .docx) to HTML using LibreOffice
     * (headless) and return the <body> markup, with any pictures inlined as
     * data URLs. The editor's own JS then cleans and borderizes it, so we hand
     * back the converted body otherwise untouched.
     */
    public function convert(Request $request)
    {
        $request->validate([
            'file' => 'required|file|max:15360', // 15 MB
        ]);

        $file = $request->file('file');
        $ext = strtolower($file->getClientOriginalExtension());
        if (! in_array($ext, ['doc', 'docx'], true)) {
            return response()->json(['message' => 'Only .doc or .docx files are allowed.'], 422);
        }

        $soffice = '/usr/bin/soffice';
        if (! is_executable($soffice)) {
            return response()->json(['message' => 'Document converter is not available on the server.'], 422);
        }

        $work = storage_path('app/doc_convert/'.Str::uuid());
        if (! is_dir($work) && ! @mkdir($work, 0775, true) && ! is_dir($work)) {
            return response()->json(['message' => 'Could not prepare the conversion workspace.'], 500);
        }

        try {
            $input = $work.'/source.'.$ext;
            $file->move($work, basename($input));

            $process = new Process([
                $soffice,
                '--headless',
                '--norestore',
                '-env:UserInstallation=file://'.$work.'/profile',
                '--convert-to', 'html:HTML',
                '--outdir', $work,
                $input,
            ]);
            $process->setTimeout(90);
            $process->run();

            $htmlPath = $work.'/source.html';
            if (! $process->isSuccessful() || ! is_file($htmlPath)) {
                return response()->json(['message' => 'Could not convert this Word file.'], 422);
            }

            $html = file_get_contents($htmlPath) ?: '';

            // Before the workspace is torn down in `finally`: the converter
            // writes pictures as separate files beside the HTML, and those files
            // are about to be deleted. See ConvertedDocumentHtml.
            $body = ConvertedDocumentHtml::inlineImages($this->extractBody($html), $work);

            return response()->json(['html' => $body]);
        } finally {
            $this->rrmdir($work);
        }
    }

    /** Return only the inner <body> markup (the rest is LibreOffice boilerplate). */
    private function extractBody(string $html): string
    {
        if (preg_match('/<body[^>]*>([\s\S]*?)<\/body>/i', $html, $m)) {
            return trim($m[1]);
        }

        return trim($html);
    }

    /** Recursively remove the temporary conversion workspace. */
    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (array_diff(scandir($dir) ?: [], ['.', '..']) as $item) {
            $path = $dir.'/'.$item;
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
