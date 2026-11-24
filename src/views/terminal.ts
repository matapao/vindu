// Terminals on the host: a real terminal (a pseudo-terminal) running the person's own shell in the process's folder, and
// a headless terminal beside it that holds what it shows: the screen, the scrollback, and each command with its output,
// exit code and folder, from the marks the shell writes (shells.ts). Everything the terminal printed is also kept raw,
// in the process's folder, so nothing depends on the scrollback.
// The window draws the terminal (xterm.js) from the same bytes; the model reads it as text, as a view of the ui server
// (read_view), and only a terminal the person shares. The terminal runs outside the processor's sandbox, so the model
// types into it (act_in_view: run) only where the host allows that, and the person says yes to each command first.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { shellSetup, unescapeLine } from './shells.js';
import { terminalEnvironment } from './terminal-environment.js';
import { now } from './time.js';

// node-pty (a native addon) and xterm load with the first terminal, so a window without terminals never loads them
const need = createRequire(import.meta.url);
type TerminalModules = {
  pty: typeof import('@lydell/node-pty');
  Headless: (typeof import('@xterm/headless'))['Terminal'];
  SerializeAddon: (typeof import('@xterm/addon-serialize'))['SerializeAddon'];
};
let loaded: TerminalModules | undefined;
const terminalModules = (): TerminalModules => (loaded ??= {
  pty: need('@lydell/node-pty') as TerminalModules['pty'],
  Headless: (need('@xterm/headless') as typeof import('@xterm/headless')).Terminal,
  SerializeAddon: (need('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')).SerializeAddon,
});
type HeadlessTerminal = InstanceType<TerminalModules['Headless']>;
type Marker = { line: number; isDisposed: boolean; dispose(): void };

/** One command as the terminal showed it: what was run, where, its exit code, and what it printed; by: 'model' when it
 *  was typed for the model (run), after the person's yes. */
export type Command = { n: number; command: string; cwd: string | null; exit: number | null; output: string; started: string; ended: string | null; cut?: string; by?: 'model' };
export type TerminalInfo = { id: string; title: string; shell: string; cwd: string; shared: boolean; running: boolean; cols: number; rows: number; marks: boolean;
  commands: number; busy: boolean; last?: { n: number; command: string; exit: number | null } };
export type TerminalOptions = {
  dir: string;                         // where raw logs and the shell scripts go: the process's own folder, not cwd
  /** The shell's whole environment. By default only what a shell needs of the host's (terminalEnvironment): who the
   *  person is, their home and path, language, display, SSH agent and proxy; their startup files set the rest. Pass it
   *  to give the shell more (process.env for all of the host's), or less. */
  env?: NodeJS.ProcessEnv;
  shell?: string;                      // the person's own shell, by default ($SHELL, or ComSpec on Windows)
  scrollback?: number;                 // lines the headless terminal keeps (the raw log keeps everything)
  login?: boolean;                     // start the shell as a login shell would (macOS apps get little PATH otherwise)
  onCommand?: (id: string, c: Command) => void; // a command ended
  onExit?: (id: string, code: number) => void;
  /** Where the shell runs, when not here: a pseudo-terminal in the processor's box, say. It gets only what Vindu adds to
   *  the environment (the box has its own), and the start-up scripts written under dir, by their paths under it. */
  spawn?: (o: { shell: string; args: string[]; env: Record<string, string>; cwd: string; cols: number; rows: number; dir: string }) => PtyLike;
};
/** What a terminal needs of its pseudo-terminal: node-pty's, or one elsewhere that behaves the same. */
export type PtyLike = { onData(f: (d: string) => void): { dispose(): void }; onExit(f: (e: { exitCode: number }) => void): { dispose(): void }; write(d: string): void; resize(cols: number, rows: number): void; kill(): void };

type Live = {
  info: TerminalInfo; proc: PtyLike; term: HeadlessTerminal; ser: InstanceType<TerminalModules['SerializeAddon']>; log: fs.WriteStream; listeners: Set<(d: string) => void>; commands: Command[];
  sharing?: AbortController;
  prompt?: { at: Marker; x: number }; line?: string; open?: { cmd: Command; out: Marker }; typing?: string;
  paste?: boolean;                                              // the line editor at the prompt takes bracketed paste
  waiters: { done: (c: Command) => void; gone: () => void }[];  // run(): the model's command, until its end mark, its time, or the terminal's end
  subs: { dispose(): void }[]; closed?: boolean;                 // closed: what the pseudo-terminal still has in flight goes nowhere
};

/** Why a command can't be typed as one line, if it can't. A control character (a newline, Ctrl+A, an escape) would edit
 *  the line in the shell after the person approved it, so what ran would not be what they read. */
export const commandRefusal = (command: string): string | undefined =>
  /\p{Cc}/u.test(command) ? 'one command, on one line, without control characters (newlines, tabs or escapes)' : undefined;

export class Terminals {
  private readonly live = new Map<string, Live>();
  private n = 0;
  constructor(private readonly o: TerminalOptions) { fs.mkdirSync(o.dir, { recursive: true }); }

  /** A new terminal in cwd, with the person's own shell; or a program of the person's, run there as it is (run), with no
   *  marks: a harness's own sign-in, say. */
  create(c: { cwd: string; title?: string; cols?: number; rows?: number; shell?: string; run?: { command: string; args: string[]; env?: Record<string, string> } }): TerminalInfo {
    const id = `t${++this.n}`;
    const env = this.o.env ?? terminalEnvironment();
    const shell = c.run?.command ?? c.shell ?? this.o.shell ?? (process.platform === 'win32' ? env.ComSpec ?? 'cmd.exe' : env.SHELL ?? '/bin/bash');
    const setup = c.run ? { args: c.run.args, env: c.run.env ?? {}, marks: false } : shellSetup(shell, this.o.dir, { login: this.o.login ?? process.platform === 'darwin', env });
    const cols = c.cols ?? 100, rows = c.rows ?? 30;
    // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- a terminal is the person's own shell; the model's commands are refused with control characters (commandRefusal) and typed in, never spawned
    const proc: PtyLike = this.o.spawn ? this.o.spawn({ shell, args: setup.args, env: { ...setup.env, TERM_PROGRAM: 'vindu' }, cwd: c.cwd, cols, rows, dir: this.o.dir })
      : terminalModules().pty.spawn(shell, setup.args, { name: 'xterm-256color', cols, rows, cwd: c.cwd,
        env: { ...Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined)), ...setup.env, TERM_PROGRAM: 'vindu' } });
    const { Headless, SerializeAddon } = terminalModules();
    const term = new Headless({ cols, rows, scrollback: this.o.scrollback ?? 5000, allowProposedApi: true });
    const info: TerminalInfo = { id, title: c.title ?? `Terminal ${this.n}`, shell, cwd: c.cwd, shared: false, running: true, cols, rows, marks: setup.marks, commands: 0, busy: false };
    const log = fs.createWriteStream(path.join(this.o.dir, `terminal-${id}.log`), { flags: 'a', mode: 0o600 }); // what ran, and what it printed: the person's alone
    log.on('error', () => undefined); // its folder went with its task: what is left of the output is kept nowhere
    const ser = new SerializeAddon(); term.loadAddon(ser);
    const t: Live = { info, proc, term, ser, log, listeners: new Set(), commands: [], waiters: [], subs: [] };
    this.marks(t);
    t.subs.push(proc.onData(d => { if (t.closed) return; log.write(d); term.write(d); for (const l of t.listeners) l(d); }),
      proc.onExit(({ exitCode }) => { info.running = false; info.busy = false; if (!t.closed) { for (const w of t.waiters.splice(0)) w.gone(); this.o.onExit?.(id, exitCode); } }));
    this.live.set(id, t);
    return { ...info };
  }

  list(): TerminalInfo[] { return [...this.live.values()].map(t => this.infoOf(t)); }
  info(id: string): TerminalInfo { return this.infoOf(this.get(id)); }
  has(id: string): boolean { return this.live.has(id); }

  /** What the terminal prints, as it prints it, for a window to draw. */
  onData(id: string, cb: (d: string) => void): () => void { const t = this.get(id); t.listeners.add(cb); return () => t.listeners.delete(cb); }
  /** The screen and scrollback so far, as escape sequences a window writes first, so it catches up. */
  replay(id: string): string { return this.get(id).ser.serialize({ scrollback: 1000 }); }
  /** For a window that draws the terminal: first what it shows so far (as escape sequences), then each byte it prints
   *  from then on, with none lost or twice: the replay is taken once the headless terminal has parsed all that came
   *  before, and what comes in meanwhile waits for it. */
  attach(id: string, cb: (d: string) => void): () => void {
    const t = this.get(id); const held: string[] = []; let live = false;
    const l = (d: string) => { if (live) cb(d); else held.push(d); };
    t.listeners.add(l);
    t.term.write('', () => { if (t.closed || !t.listeners.has(l)) return; cb(t.ser.serialize({ scrollback: 1000 })); for (const d of held.splice(0)) cb(d); live = true; });
    return () => { t.listeners.delete(l); };
  }
  /** The person's keys. */
  input(id: string, data: string): void { const t = this.get(id); if (t.info.running) t.proc.write(data); }
  resize(id: string, cols: number, rows: number): void {
    const t = this.get(id); if (!(cols > 1 && rows > 1 && cols < 1000 && rows < 500) || !t.info.running) return;
    t.proc.resize(Math.floor(cols), Math.floor(rows)); t.term.resize(Math.floor(cols), Math.floor(rows)); t.info.cols = Math.floor(cols); t.info.rows = Math.floor(rows);
  }
  /** Whether the model may read this terminal. The person decides, per terminal. */
  share(id: string, on: boolean): TerminalInfo {
    const t = this.get(id);
    if (on && !t.sharing) t.sharing = new AbortController();
    if (!on) {
      t.sharing?.abort(new Error(`The person stopped sharing ${t.info.title}.`));
      t.sharing = undefined;
    }
    t.info.shared = on;
    return this.infoOf(t);
  }

  /** A pending model command is authorized only for this period of sharing. */
  whileShared(id: string): AbortSignal {
    const t = this.get(id);
    if (!t.sharing) throw new Error(`the person has not shared ${t.info.title} with you; they can, from its pane`);
    return t.sharing.signal;
  }

  /** The screen as it is now, as text. */
  screen(id: string): string {
    const t = this.get(id); const b = t.term.buffer.active; const out: string[] = [];
    for (let y = b.baseY; y < b.baseY + t.term.rows; y++) out.push(b.getLine(y)?.translateToString(true) ?? '');
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
  }
  /** The commands run so far, the last ones last; the one still running has no end. */
  commands(id: string, last?: number): Command[] {
    const t = this.get(id); const all = [...t.commands, ...(t.open ? [this.running(t)] : [])];
    return last && last > 0 ? all.slice(-last) : all;
  }

  /** Type a command and wait for it to end (its D mark), or for timeoutMs. Only for a shell with marks, and not while
   *  another command runs. What the person had typed on the line is cleared first (Ctrl+U). Where the shell's line
   *  editor asks for bracketed paste (bash 5.1 and zsh do), the command goes as pasted text, so no key in it is bound
   *  to anything while it is typed. After timeoutMs: the command as far as it has run, or an error if it has not
   *  started (it is then no longer marked the model's). */
  run(id: string, command: string, timeoutMs = 30_000): Promise<{ done: Command } | { running: Command }> {
    const t = this.get(id);
    if (!t.info.running) return Promise.reject(new Error(`${t.info.title} has exited`));
    if (!t.info.marks) return Promise.reject(new Error(`${t.info.title} runs a shell without marks (${path.basename(t.info.shell)}), so the end of a command cannot be told`));
    if (t.open) return Promise.reject(new Error(`${t.info.title} is running "${t.open.cmd.command}"`));
    const refused = commandRefusal(command);
    if (refused) return Promise.reject(new Error(refused));
    return new Promise((resolve, reject) => {
      const asItStands = (why: string) => { // the model's command as it stands, if it has started
        if (t.open?.cmd.by === 'model') resolve({ running: this.running(t) });
        else { if (t.typing === command) t.typing = undefined; reject(new Error(`${t.info.title}: "${command}" ${why}`)); }
      };
      const timer = setTimeout(() => { t.waiters = t.waiters.filter(w => w !== waiter); asItStands(`did not start within ${timeoutMs} ms`); }, timeoutMs);
      const waiter = { done: (c: Command) => { clearTimeout(timer); resolve({ done: c }); }, gone: () => { clearTimeout(timer); reject(new Error(`${t.info.title} ended before "${command}" did`)); } };
      t.waiters.push(waiter); t.typing = command;
      const pasted = t.paste ? `\x1b[200~${command}\x1b[201~` : command;
      t.proc.write(`\x15${pasted}\r`);
    });
  }

  /** End a terminal: its shell, and everything about it here. What its shell still had in flight goes nowhere. */
  close(id: string): void {
    const t = this.live.get(id); if (!t) return;
    this.live.delete(id); t.closed = true;
    t.sharing?.abort(new Error(`${t.info.title} has closed.`));
    for (const s of t.subs.splice(0)) s.dispose();
    t.listeners.clear();
    for (const w of t.waiters.splice(0)) w.gone();
    try { t.proc.kill(); } catch { /* gone */ }
    t.log.end(); t.term.dispose();
  }
  closeAll(): void { for (const id of this.live.keys()) this.close(id); }

  private get(id: string): Live { const t = this.live.get(id); if (!t) throw new Error(`no terminal "${id}"`); return t; }
  private running(t: Live): Command { return { ...t.open!.cmd, output: this.textFrom(t, t.open!.out) }; }
  private infoOf(t: Live): TerminalInfo {
    const last = t.commands.at(-1);
    return { ...t.info, commands: t.commands.length, busy: !!t.open, ...(last ? { last: { n: last.n, command: last.command, exit: last.exit } } : {}) };
  }

  /** The text of the lines from a marker to the cursor's line, or to the line before `until`. */
  private textFrom(t: Live, from: Marker, until?: number): string {
    const b = t.term.buffer.active; const end = until ?? b.baseY + b.cursorY + 1;
    if (from.isDisposed || from.line < 0) return '';
    const out: string[] = [];
    for (let y = from.line; y < end; y++) {
      const l = b.getLine(y); if (!l) continue;
      const text = l.translateToString(true);
      if (l.isWrapped && out.length) out[out.length - 1] += text; else out.push(text);
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
  }

  private marks(t: Live) {
    const { term, info } = t;
    const here = () => term.registerMarker(0) as unknown as Marker;
    term.parser.registerOscHandler(133, data => {
      const [k, arg] = data.split(';');
      if (k === 'B') { t.prompt?.at.dispose(); t.prompt = { at: here(), x: term.buffer.active.cursorX }; }
      else if (k === 'C') {
        const typed = t.prompt && !t.prompt.at.isDisposed ? (term.buffer.active.getLine(t.prompt.at.line)?.translateToString(true) ?? '').slice(t.prompt.x).trim() : '';
        const cmd: Command = { n: t.commands.length + 1, command: t.line ?? typed, cwd: info.cwd, exit: null, output: '', started: now(), ended: null, ...(t.typing !== undefined ? { by: 'model' as const } : {}) };
        t.open = { cmd, out: here() }; t.line = undefined; t.typing = undefined;
      } else if (k === 'D' && t.open) { // a D without a C is a prompt after an empty line, or the first prompt
        const { cmd, out } = t.open; t.open = undefined; t.paste = false; // what the command left on is not the shell's
        const b = term.buffer.active; const y = b.baseY + b.cursorY;
        const done: Command = { ...cmd, exit: arg !== undefined && arg !== '' && Number.isFinite(Number(arg)) ? Number(arg) : null, output: this.textFrom(t, out, y), ended: now(),
          ...(out.isDisposed ? { cut: 'the start of its output scrolled out of the terminal; the raw log in the task\'s folder has all of it' } : {}) };
        out.dispose(); t.commands.push(done);
        this.o.onCommand?.(info.id, done);
        for (const w of t.waiters.splice(0)) w.done(done);
      }
      return true;
    });
    // bracketed paste as the shell's line editor turns it on for a prompt, not as a program left it when it ended
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => { if (!t.open && params.includes(2004)) t.paste = true; return false; });
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => { if (params.includes(2004)) t.paste = false; return false; });
    term.parser.registerOscHandler(633, data => {
      if (data.startsWith('E;')) t.line = unescapeLine(data.slice(2).split(';')[0]);
      else if (data.startsWith('P;Cwd=')) info.cwd = data.slice(6);
      return true;
    });
    term.parser.registerOscHandler(7, data => {
      try { const u = new URL(data); if (u.protocol === 'file:') info.cwd = decodeURIComponent(u.pathname); } catch { /* not a file URL */ }
      return true;
    });
  }
}
