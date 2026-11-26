// A real terminal with a real bash: each command with its output, exit code and folder from the shell's own marks; the
// screen as text; a command run on the person's say-so waits for its end; what it printed is kept raw.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import headless from '@xterm/headless';
import { Terminals, type Command, type PtyLike } from '../src/index.js';
import { terminalEnvironment } from '../src/views/terminal-environment.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

test("commands come from the shell's own marks: what ran, where, its exit code and what it printed", async () => {
  const home = tmp('home-'),
    dir = tmp('task-'),
    work = tmp('work-');
  fs.writeFileSync(path.join(home, '.bashrc'), 'export FROM_THEIR_RC=yes\nPS1="their-prompt> "\n'); // the person's own startup file runs first
  const ended: Command[] = [];
  const terms = new Terminals({
    dir,
    shell: 'bash',
    login: false,
    env: { PATH: process.env.PATH, HOME: home, HISTFILE: '/dev/null', LANG: 'C.UTF-8' },
    onCommand: (_id, c) => ended.push(c),
  });
  const t = terms.create({ cwd: work, cols: 80, rows: 20 });
  try {
    assert.equal(t.marks, true);
    let drawn = '';
    const off = terms.onData(t.id, (d) => {
      drawn += d;
    });
    await until(() => terms.screen(t.id).includes('their-prompt>'));
    terms.input(t.id, 'echo "a;b"; echo $FROM_THEIR_RC\r');
    await until(() => ended.length === 1);
    terms.input(t.id, 'ls /nope-synthetic\r');
    await until(() => ended.length === 2);
    terms.input(t.id, '\r'); // an empty line is no command
    terms.input(t.id, 'mkdir sub && cd sub\r');
    await until(() => ended.length === 3);
    const cs = terms.commands(t.id);
    const lsExit = process.platform === 'darwin' ? 1 : 2; // BSD ls says 1 for a file that is not there, GNU ls 2
    assert.deepEqual(
      cs.map((c) => [c.n, c.command, c.exit, c.by]),
      [
        [1, 'echo "a;b"; echo $FROM_THEIR_RC', 0, undefined],
        [2, 'ls /nope-synthetic', lsExit, undefined],
        [3, 'mkdir sub && cd sub', 0, undefined],
      ],
    ); // the person's
    assert.equal(cs[0].output, 'a;b\nyes');
    assert.match(cs[1].output, /No such file or directory/);
    assert.equal(cs[0].cwd, work);
    await until(() => terms.info(t.id).cwd === path.join(work, 'sub')); // the folder, from OSC 7
    assert.equal(terms.info(t.id).last?.command, 'mkdir sub && cd sub');
    assert.match(terms.screen(t.id), /their-prompt> /);
    assert.ok(drawn.includes('a;b'));
    off();
    assert.match(terms.replay(t.id), /their-prompt>/); // a window opened later catches up
    assert.ok(fs.readFileSync(path.join(dir, `terminal-${t.id}.log`), 'utf8').includes('No such file or directory')); // raw, as printed
  } finally {
    terms.closeAll();
  }
});

test('a command run for the model waits for its end mark; one at a time, one line, only with marks', async () => {
  const home = tmp('home-'),
    dir = tmp('task-'),
    work = tmp('work-');
  const terms = new Terminals({
    dir,
    shell: 'bash',
    login: false,
    env: { PATH: process.env.PATH, HOME: home, HISTFILE: '/dev/null' },
  });
  const t = terms.create({ cwd: work });
  try {
    await until(() => terms.screen(t.id).length > 0);
    terms.input(t.id, 'half-typed');
    const r = await terms.run(t.id, 'printf "%s\\n" one two; false');
    assert.ok('done' in r);
    assert.equal(r.done.exit, 1);
    assert.equal(r.done.output, 'one\ntwo');
    assert.equal(r.done.command, 'printf "%s\\n" one two; false'); // what the person had typed was cleared
    assert.equal(r.done.by, 'model');
    const slow = terms.run(t.id, 'sleep 0.6; echo late', 100);
    const s = await slow;
    assert.ok('running' in s);
    assert.equal(s.running.ended, null);
    await assert.rejects(terms.run(t.id, 'echo again'), /is running "sleep 0.6; echo late"/);
    await until(() => !terms.info(t.id).busy);
    await assert.rejects(terms.run(t.id, 'echo a\necho b'), /one command, on one line/);
    const plain = new Terminals({ dir: tmp('task-'), shell: '/bin/sh', env: { PATH: process.env.PATH, HOME: home } });
    const p = plain.create({ cwd: work });
    await assert.rejects(plain.run(p.id, 'echo hi'), /without marks/);
    plain.closeAll();
  } finally {
    terms.closeAll();
  }
});

test('a window that opens later draws just what the terminal shows: the replay first, then each byte once', async () => {
  const terms = new Terminals({
    dir: tmp('task-'),
    shell: 'bash',
    login: false,
    env: { PATH: process.env.PATH, HOME: tmp('home-'), HISTFILE: '/dev/null' },
  });
  const t = terms.create({ cwd: tmp('work-'), cols: 80, rows: 24 });
  const mirror = new headless.Terminal({ cols: 80, rows: 24, scrollback: 5000, allowProposedApi: true }); // as xterm.js in the window
  try {
    await until(() => terms.screen(t.id).length > 0);
    terms.input(t.id, 'for i in $(seq 1 300); do echo line-$i; sleep 0.004; done\r');
    await until(() => terms.screen(t.id).includes('line-40')); // the window opens while it prints
    let chunks = 0;
    const off = terms.attach(t.id, (d) => {
      chunks++;
      mirror.write(d);
    });
    await until(() => terms.commands(t.id).length === 1 && !terms.info(t.id).busy, 15_000);
    off();
    await new Promise<void>((r) => mirror.write('', r));
    const b = mirror.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < b.length; y++) {
      const l = b.getLine(y)?.translateToString(true) ?? '';
      if (/^line-\d+$/.test(l)) lines.push(l);
    }
    assert.deepEqual(
      lines,
      Array.from({ length: 300 }, (_, i) => `line-${i + 1}`),
    ); // none lost, none twice, in order
    assert.ok(chunks > 1);
  } finally {
    mirror.dispose();
    terms.closeAll();
  }
});

test('a terminal closed while it prints leaves nothing behind: nothing written after its end', async () => {
  const terms = new Terminals({
    dir: tmp('task-'),
    shell: 'bash',
    login: false,
    env: { PATH: process.env.PATH, HOME: tmp('home-'), HISTFILE: '/dev/null' },
  });
  for (let i = 0; i < 5; i++) {
    // the race is in timing: close while the shell pours out output, a few times
    const t = terms.create({ cwd: tmp('work-') });
    await until(() => terms.screen(t.id).length > 0);
    terms.input(t.id, 'while true; do echo synthetic-noise-$RANDOM; done\r');
    await until(() => terms.screen(t.id).includes('synthetic-noise'));
    terms.close(t.id);
    assert.equal(terms.has(t.id), false);
    await new Promise((r) => setTimeout(r, 150)); // what the pseudo-terminal still had in flight arrives now, and must go nowhere
  }
});

test("sharing is per terminal and the person's", () => {
  const terms = new Terminals({
    dir: tmp('task-'),
    shell: 'bash',
    env: { PATH: process.env.PATH, HOME: tmp('home-') },
  });
  const t = terms.create({ cwd: tmp('work-') });
  try {
    assert.equal(t.shared, false);
    assert.equal(terms.share(t.id, true).shared, true);
    assert.equal(terms.list()[0].shared, true);
    assert.throws(() => terms.info('t99'), /no terminal "t99"/);
  } finally {
    terms.closeAll();
  }
});

test("a command for the model goes as bracketed paste where the shell's line editor asks for it, and as typed where not", async () => {
  const writes: string[] = [];
  let shell!: (d: string) => void;
  const pty: PtyLike = {
    onData: (f) => {
      shell = f;
      return { dispose() {} };
    },
    onExit: () => ({ dispose() {} }),
    write: (d) => {
      writes.push(d);
    },
    resize() {},
    kill() {},
  };
  const terms = new Terminals({ dir: tmp('task-'), shell: 'bash', spawn: () => pty });
  const t = terms.create({ cwd: tmp('work-') });
  const parsed = () => new Promise((r) => setTimeout(r, 30));
  const ran = async (command: string, during = '', prompt = '\x1b[?2004h') => {
    // the shell's side: the line, the command, its end, a prompt
    const run = terms.run(t.id, command, 2000);
    await parsed();
    shell(
      `\x1b[?2004l\x1b]633;E;${command}\x07\x1b]133;C\x07\r\n${during}out\r\n\x1b]133;D;0\x07\x1b]133;A\x07${prompt}$ \x1b]133;B\x07`,
    );
    assert.ok('done' in (await run));
  };
  try {
    shell('\x1b]133;A\x07\x1b[?2004h$ \x1b]133;B\x07');
    await parsed(); // a prompt whose line editor takes bracketed paste (bash 5.1, zsh)
    await ran('echo one', '\x1b[?2004h', ''); // a program turns it on and leaves it so; the next prompt's editor does not ask for it
    await ran('echo two');
    await ran('echo three');
    assert.deepEqual(writes, [
      '\x15\x1b[200~echo one\x1b[201~\r',
      '\x15echo two\r',
      '\x15\x1b[200~echo three\x1b[201~\r',
    ]);
  } finally {
    terms.closeAll();
  }
});

const zsh = (() => {
  try {
    execFileSync('zsh', ['-c', 'exit'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
test.skipIf(!zsh)(
  "a key the person bound to something does not change the model's command as it is typed (zsh)",
  async () => {
    const home = tmp('home-');
    fs.writeFileSync(path.join(home, '.zshrc'), "bindkey -s q Q\nPS1='their-prompt> '\n"); // typed, q would become Q
    const terms = new Terminals({
      dir: tmp('task-'),
      shell: 'zsh',
      login: false,
      env: { PATH: process.env.PATH, HOME: home, HISTFILE: '/dev/null' },
    });
    const t = terms.create({ cwd: tmp('work-') });
    try {
      await until(() => terms.screen(t.id).includes('their-prompt>'));
      const r = await terms.run(t.id, 'echo quiet');
      assert.ok('done' in r);
      assert.equal(r.done.command, 'echo quiet');
      assert.equal(r.done.output, 'quiet');
    } finally {
      terms.closeAll();
    }
  },
);

test("a terminal's shell gets only what a shell needs of the host's environment, unless the host gives it more", async () => {
  assert.deepEqual(
    terminalEnvironment({
      PATH: '/bin',
      HOME: '/h',
      LANG: 'C.UTF-8',
      LC_ALL: 'C',
      XDG_RUNTIME_DIR: '/run/1',
      http_proxy: 'http://proxy',
      SSH_AUTH_SOCK: '/agent',
      Path: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      API_TOKEN: 'synthetic',
      NODE_OPTIONS: '--inspect',
      ELECTRON_RUN_AS_NODE: '1',
      EMPTY: undefined,
    }),
    {
      PATH: '/bin',
      HOME: '/h',
      LANG: 'C.UTF-8',
      LC_ALL: 'C',
      XDG_RUNTIME_DIR: '/run/1',
      http_proxy: 'http://proxy',
      SSH_AUTH_SOCK: '/agent',
      Path: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
    },
  );
  const home = tmp('home-'),
    saved = { HOME: process.env.HOME, token: process.env.VINDU_SYNTHETIC_TOKEN, lc: process.env.LC_SYNTHETIC };
  Object.assign(process.env, { HOME: home, VINDU_SYNTHETIC_TOKEN: 'synthetic-credential', LC_SYNTHETIC: 'kept' }); // the host's own, with a credential
  const restore = () => {
    for (const [name, value] of [
      ['HOME', saved.HOME],
      ['VINDU_SYNTHETIC_TOKEN', saved.token],
      ['LC_SYNTHETIC', saved.lc],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const terms = new Terminals({ dir: tmp('task-'), shell: 'bash', login: false });
  const more = new Terminals({
    dir: tmp('task-'),
    shell: 'bash',
    login: false,
    env: { ...process.env, HISTFILE: '/dev/null' },
  }); // the host passes all of its own
  try {
    const t = terms.create({ cwd: tmp('work-') }),
      m = more.create({ cwd: tmp('work-') });
    restore();
    await until(() => terms.screen(t.id).length > 0 && more.screen(m.id).length > 0);
    const line = 'echo "${VINDU_SYNTHETIC_TOKEN-unset} $LC_SYNTHETIC $HOME"';
    const [own, given] = await Promise.all([terms.run(t.id, line), more.run(m.id, line)]);
    assert.ok('done' in own && 'done' in given);
    assert.equal(own.done.output, `unset kept ${home}`);
    assert.equal(given.done.output, `synthetic-credential kept ${home}`);
  } finally {
    restore();
    terms.closeAll();
    more.closeAll();
  }
});
