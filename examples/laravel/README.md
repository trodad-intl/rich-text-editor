# Laravel example

A Blade form using `<trodad-rich-text-editor>`, and the Word-conversion
endpoint behind the toolbar's Word button, taken from a production app.

1. Copy the package's `dist/standalone/` folder and the stylesheet(s) into `public/vendor/rich-text-editor/`.
2. Add the route:

   ```php
   Route::post('/tools/word-to-html', [\App\Http\Controllers\Tools\DocToHtmlController::class, 'convert'])
       ->name('tools.word_to_html')
       ->middleware('auth');
   ```

3. Install LibreOffice on the server (`apt-get install -y libreoffice-writer`). It is only
   needed for `.doc` files and higher-fidelity `.docx` conversion; without the endpoint,
   `.docx` is converted in the browser.
4. Use `resources/views/post-form.blade.php` as the template.
