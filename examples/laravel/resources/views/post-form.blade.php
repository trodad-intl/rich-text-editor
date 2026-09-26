{{-- A form using @trodad/rich-text-editor. No npm, no Vite, no React on this page. --}}
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Edit post</title>
    {{-- On a Bootstrap 5 page use rich-text-editor.bootstrap.css instead. --}}
    <link rel="stylesheet" href="{{ asset('vendor/rich-text-editor/rich-text-editor.css') }}">
    <script type="module" src="{{ asset('vendor/rich-text-editor/standalone/rich-text-editor.js') }}"></script>
</head>
<body>
    <form method="POST" action="{{ route('posts.store') }}">
        @csrf

        {{-- The stored HTML goes INSIDE the tag, escaped with {{ }} — not {!! !!}. --}}
        <trodad-rich-text-editor
            name="body"
            min-height="500"
            placeholder="Write something…"
            word-import-url="{{ route('tools.word_to_html') }}">{{ old('body', $post->body ?? '') }}</trodad-rich-text-editor>

        @error('body')
            <p>{{ $message }}</p>
        @enderror

        <button type="submit">Save</button>
    </form>
</body>
</html>
