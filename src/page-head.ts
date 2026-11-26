// A file of the working folder as the last commit has it, for diff panels. Vindu runs no git of its own: a host that
// wants diffs passes gitHead(work) as the process's head. That is the host's decision to make, because whoever can
// write in the folder (the model, a cloned repository) also writes its git configuration, and git reads that
// configuration as it runs. A partial clone's promisor remote, for one, is fetched from to read an object it lacks,
// and its url can name a command (ext::sh -c …) that then runs as the person.
//
// So gitHead runs only plumbing (rev-parse, cat-file blob), never a fetch: no lazy fetch (GIT_NO_LAZY_FETCH), no
// transport at all (GIT_ALLOW_PROTOCOL, which outranks a repository's protocol.<name>.allow), no fsmonitor, no
// pager, no prompt, no system configuration, none of the host's GIT_* variables, and a timeout. It refuses a git
// older than 2.45, which does not know GIT_NO_LAZY_FETCH. The lines changed are counted outside the repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inside } from './page-workspace.js';

/** A file of the working folder as the last commit has it (git HEAD), with git's count of the lines changed since (a
 *  file the commit does not have is new since it); or why there is nothing to compare with. */
export type HeadText = { text: string; commit: string; added: number; removed: number; new?: true } | { why: string };
/** The largest file a code or diff panel shows. */
export const TEXT_MAX = 2_000_000;
/** The oldest git that keeps from fetching what a repository names (GIT_NO_LAZY_FETCH). */
const OLDEST: [number, number] = [2, 45];

/** git's environment here: the host's, without its GIT_* variables, and with every route to a fetch, a prompt or a
 *  pager closed. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!/^GIT_/i.test(name)) env[name] = value;
  return {
    ...env,
    GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
}
const run = (args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2 * TEXT_MAX,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...o,
  });
/** How git runs on the folder: plumbing only, with no fsmonitor, pager or transport. */
const inRepository = (work: string, ...args: string[]) =>
  run(['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-C', work, ...args], {
    env: gitEnv(),
  });

let checked: string | null | undefined; // why this git is not used, once asked; null: it is
/** Why git is not used here (not there, or older than 2.45), or null. Asked once. */
function gitRefused(): string | null {
  if (checked !== undefined) return checked;
  let said: string;
  try {
    said = run(['--version'], { env: gitEnv() });
  } catch {
    return (checked =
      'git is not installed here, so there is no last commit to compare with; show the file with a code panel');
  }
  const [, major, minor] = /(\d+)\.(\d+)/.exec(said) ?? [];
  const old = !major || Number(major) < OLDEST[0] || (Number(major) === OLDEST[0] && Number(minor) < OLDEST[1]);
  checked = old
    ? `git ${said.trim().replace(/^git version /, '')} is older than ${OLDEST.join('.')}, which a diff needs here (so that reading a repository never fetches); show the file with a code panel`
    : null;
  return checked;
}

/** A process's head for a working folder that is a git repository: each file as the folder's last commit has it. */
export function gitHead(work: string): (rel: string) => HeadText {
  return (rel) => {
    const refused = gitRefused();
    if (refused) return { why: refused };
    const file = inside(work, rel.replace(/^\/+/, ''));
    if (!file) return { why: `no file "${rel}" in the working folder` };
    const name = path.relative(fs.realpathSync(work), file).split(path.sep).join('/');
    let commit: string;
    try {
      commit = inRepository(work, 'rev-parse', '--short', 'HEAD').trim();
    } catch (e) {
      const said = String((e as { stderr?: string }).stderr ?? e);
      return {
        why: /not a git repository/i.test(said)
          ? 'the working folder is not a git repository, so there is no last commit to compare with; show the file with a code panel'
          : 'the working folder has no commit yet to compare with; show the file with a code panel',
      };
    }
    let blob: string | undefined;
    try {
      blob = inRepository(work, 'rev-parse', '--verify', '--quiet', `HEAD:./${name}`).trim();
    } catch (e) {
      if ((e as { status?: number }).status !== 1)
        return { why: `git could not read "${name}" in the last commit; show the file with a code panel` };
    }
    const { bytes } = readText(file);
    if (!bytes) return { why: `"${name}" is over ${TEXT_MAX / 1e6} MB; diff panels show files up to that` };
    if (!blob) {
      // not in the last commit: all of it is new
      const now = bytes.toString('utf8');
      return {
        text: '',
        commit,
        added: now ? now.split('\n').length - (now.endsWith('\n') ? 1 : 0) : 0,
        removed: 0,
        new: true,
      };
    }
    let text: string;
    try {
      text = inRepository(work, 'cat-file', 'blob', blob);
    } catch {
      return {
        why: `git could not read "${name}" in the last commit (its repository lacks it here); show the file with a code panel`,
      };
    }
    try {
      const [added, removed] = changedLines(text, bytes);
      return { text, commit, added, removed };
    } catch {
      return { why: `git could not count the lines changed in "${name}"; show the file with a code panel` };
    }
  };
}

/** A file read through one descriptor, so that the size checked is the size of what is read: its size, and its bytes
 *  when it is at most max (TEXT_MAX by default). */
export function readText(file: string, max = TEXT_MAX): { size: number; bytes?: Buffer } {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    return size > max ? { size } : { size, bytes: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}

/** Lines added and removed between a text and the bytes read now, as git counts them. git runs on two plain files in a
 *  folder of its own, outside the repository, so nothing the repository configures (filters, fsmonitor, an external
 *  diff) runs here, and what it compares is what was read. */
function changedLines(before: string, now: Buffer): [number, number] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vindu-head-'));
  try {
    const head = path.join(dir, 'head'),
      current = path.join(dir, 'now');
    fs.writeFileSync(head, before);
    fs.writeFileSync(current, now);
    let out: string;
    try {
      out = run(
        [
          'diff',
          '--no-index',
          '--numstat',
          '--no-ext-diff',
          '--no-textconv',
          '--ignore-cr-at-eol',
          '--',
          head,
          current,
        ],
        {
          cwd: dir,
          env: { ...gitEnv(), GIT_CEILING_DIRECTORIES: path.dirname(dir) }, // no repository above this folder is looked for
        },
      );
    } catch (e) {
      // 1: the files differ
      const x = e as { status?: number; stdout?: string };
      if (x.status !== 1) throw e;
      out = x.stdout ?? '';
    }
    const [added, removed] = out.split('\t').map(Number);
    return [added || 0, removed || 0];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
