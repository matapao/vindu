// Code and diff panels: a file in the process's working folder, in Monaco (the VS Code editor), read-only, on a page of
// Vindu's own that the page host serves like any page (offline: Monaco is pinned there, /lib/monaco-editor/). The page
// reads the file as it is now (/work/<path>?raw=1), and again whenever it changes; a diff page also gets the file as the
// last commit has it, written into the page.
import { escapeText, scriptJson } from './escape.js';

const LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', xml: 'xml', svg: 'xml', py: 'python', rs: 'rust',
  go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql', lua: 'lua', r: 'r', dart: 'dart', ini: 'ini', toml: 'ini',
};
/** The language Monaco highlights a file in, by its name. */
export function languageOf(file: string): string {
  const name = file.split('/').pop() ?? '';
  if (/^dockerfile$/i.test(name)) return 'dockerfile';
  return LANGUAGES[name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''] ?? 'plaintext';
}

export type CodeSpec = { path: string; language: string; line?: number; original?: string; against?: string };

/** The page for a code or diff panel. Everything it needs is in the page or on the process's own origin. */
export function codePage(spec: CodeSpec): string {
  const data = scriptJson(spec);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>${escapeText(spec.path)}</title>
<style>html,body{margin:0;height:100%;background:Canvas;color:CanvasText}#code{position:absolute;inset:0}</style></head>
<body><div id="code"></div><script src="/lib/monaco-editor/vs/loader.js"></script><script>
const spec = ${data};
require.config({ paths: { vs: '/lib/monaco-editor/vs' } });
require(['vs/editor/editor.main'], async () => {
  const read = async () => { const r = await fetch('/work/' + spec.path.split('/').map(encodeURIComponent).join('/') + '?raw=1', { cache: 'no-store' }); if (!r.ok) throw new Error('the file is gone: ' + spec.path); return r.text(); };
  const dark = matchMedia('(prefers-color-scheme: dark)'), theme = () => monaco.editor.setTheme(dark.matches ? 'vs-dark' : 'vs');
  const opts = { readOnly: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13 };
  const now = monaco.editor.createModel(await read(), spec.language), at = document.getElementById('code');
  let editor;
  if (spec.original !== undefined) {
    editor = monaco.editor.createDiffEditor(at, { ...opts, originalEditable: false, renderSideBySide: innerWidth >= 640, useInlineViewWhenSpaceIsLimited: true });
    editor.setModel({ original: monaco.editor.createModel(spec.original, spec.language), modified: now });
  } else {
    editor = monaco.editor.create(at, { ...opts, model: now });
    if (spec.line) { editor.revealLineInCenter(spec.line); editor.setSelection(new monaco.Range(spec.line, 1, spec.line, 1)); }
  }
  theme(); dark.addEventListener('change', theme);
  // the file changed: read it again, where the person was in it
  task.on('change', async paths => {
    if (!paths.includes('*') && !paths.includes(spec.path)) return;
    try { const text = await read(); if (text !== now.getValue()) { const kept = editor.saveViewState(); now.setValue(text); editor.restoreViewState(kept); } } catch (e) { console.warn(String(e.message || e)); }
  });
  document.body.dataset.ready = '1';
});
</script></body></html>`;
}
