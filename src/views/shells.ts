// The marks a shell writes, so a terminal knows where each command starts and ends, its exit code and its folder:
//   OSC 133;A  a prompt starts          OSC 133;B  the prompt ends: the person types from here
//   OSC 133;C  the command runs         OSC 133;D;<exit>  it ended, with its exit code
//   OSC 633;E;<command line>  the command as the shell read it (VS Code's escaping: \\ and \x3b)
//   OSC 7;file://<host><folder>  the folder
// These are the marks VS Code's shell integration and other terminals write. Each script loads the person's own startup
// files first, so the shell is theirs; then it adds the marks. bash and zsh get them; other shells run as they are,
// without marks (the screen is still there, but not the commands).
import fs from 'node:fs';
import path from 'node:path';

export type ShellSetup = { args: string[]; env: Record<string, string>; marks: boolean };

// The lines are kept apart from TypeScript's template literals, whose ${…} is the shell's too.
const BASH =
  [
    "# vindu: the person's own startup files first; then the marks (OSC 133, 633;E, 7)",
    'if [ -n "$VINDU_LOGIN" ]; then',
    '  [ -f /etc/profile ] && . /etc/profile',
    '  for __vindu_f in ~/.bash_profile ~/.bash_login ~/.profile; do [ -f "$__vindu_f" ] && { . "$__vindu_f"; break; }; done',
    'else',
    '  [ -f ~/.bashrc ] && . ~/.bashrc',
    'fi',
    'unset VINDU_LOGIN __vindu_f',
    '__vindu_esc() { local s="$1"; s="${s//\\\\/\\\\\\\\}"; s="${s//;/\\\\x3b}"; s="${s//$\'\\n\'/\\\\x0a}"; printf \'%s\' "$s"; }',
    '__vindu_cmd() { local c; c=$(HISTTIMEFORMAT= builtin history 1 2>/dev/null); c="${c#"${c%%[![:space:]]*}"}"; c="${c#"${c%%[![:digit:]]*}"}"; c="${c#"${c%%[![:space:]]*}"}"; printf \'\\033]633;E;%s\\007\\033]133;C\\007\' "$(__vindu_esc "$c")"; }',
    '__vindu_prompt() { local s=$?; __vindu_ready=; printf \'\\033]133;D;%s\\007\\033]7;file://%s%s\\007\\033]133;A\\007\' "$s" "${HOSTNAME:-localhost}" "$PWD"; return $s; }',
    'PROMPT_COMMAND="__vindu_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"',
    'PS1="${PS1:-\\$ }\\[\\033]133;B\\007\\]"',
    'PS0=\'$(__vindu_cmd)\'"${PS0}"',
    '# bash before 4.4 (macOS has 3.2) has no PS0: a command starts at the first DEBUG trap after a prompt',
    'if [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then',
    '  __vindu_ready=',
    '  __vindu_debug() { [ -n "$__vindu_ready" ] && [ -z "$COMP_LINE" ] || return 0; case "$BASH_COMMAND" in __vindu_prompt*) return 0;; esac; __vindu_ready=; __vindu_cmd; }', // an empty line runs the prompt again: no command
    "  trap '__vindu_debug' DEBUG",
    '  PROMPT_COMMAND="${PROMPT_COMMAND}; __vindu_ready=1"',
    'fi',
  ].join('\n') + '\n';

const ZSHRC =
  [
    "# vindu: the person's own .zshrc first; then the marks (OSC 133, 633;E, 7)",
    '__vindu_dir="$ZDOTDIR"; ZDOTDIR="${VINDU_ZDOTDIR:-$HOME}"',
    '[ -f "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"',
    '__vindu_precmd() { local s=$?; if [ -n "$__vindu_ran" ]; then printf \'\\033]133;D;%s\\007\' "$s"; fi; __vindu_ran=; printf \'\\033]7;file://%s%s\\007\\033]133;A\\007\' "${HOST:-localhost}" "$PWD"; }',
    '__vindu_preexec() { local c="$1"; c="${c//\\\\/\\\\\\\\}"; c="${c//;/\\\\x3b}"; c="${c//$\'\\n\'/\\\\x0a}"; __vindu_ran=1; printf \'\\033]633;E;%s\\007\\033]133;C\\007\' "$c"; }',
    'autoload -Uz add-zsh-hook',
    'precmd_functions=(__vindu_precmd ${precmd_functions[@]:#__vindu_precmd})',
    'add-zsh-hook preexec __vindu_preexec',
    'PS1="$PS1%{$(printf \'\\033]133;B\\007\')%}"',
  ].join('\n') + '\n';
// zsh reads its other startup files from ZDOTDIR too: each loads the person's own, keeps the ZDOTDIR that file set (an
// XDG setup sets it in ~/.zshenv), then points back here
const zshFile = (name: string) =>
  [
    `__vindu_dir="$ZDOTDIR"; ZDOTDIR="\${VINDU_ZDOTDIR:-$HOME}"`,
    `[ -f "$ZDOTDIR/${name}" ] && . "$ZDOTDIR/${name}"`,
    'VINDU_ZDOTDIR="$ZDOTDIR"; ZDOTDIR="$__vindu_dir"',
  ].join('\n') + '\n';

/** How to start this shell with the marks, writing its scripts into dir. */
export function shellSetup(
  shell: string,
  dir: string,
  o: { login?: boolean; env?: NodeJS.ProcessEnv } = {},
): ShellSetup {
  const base = path
    .basename(shell)
    .toLowerCase()
    .replace(/\.exe$/, '');
  const at = path.join(dir, 'shell');
  fs.mkdirSync(at, { recursive: true });
  if (base === 'bash') {
    const rc = path.join(at, 'bash-rc.sh');
    fs.writeFileSync(rc, BASH);
    return {
      args: ['--rcfile', rc, '-i'],
      env: { BASH_SILENCE_DEPRECATION_WARNING: '1', ...(o.login ? { VINDU_LOGIN: '1' } : {}) },
      marks: true,
    }; // macOS's bash says zsh is the default, unless silenced
  }
  if (base === 'zsh') {
    const z = path.join(at, 'zsh');
    fs.mkdirSync(z, { recursive: true });
    fs.writeFileSync(path.join(z, '.zshrc'), ZSHRC);
    for (const f of ['.zshenv', '.zprofile', '.zlogin']) fs.writeFileSync(path.join(z, f), zshFile(f));
    return {
      args: o.login ? ['-l', '-i'] : ['-i'],
      env: { ZDOTDIR: z, VINDU_ZDOTDIR: o.env?.ZDOTDIR ?? o.env?.HOME ?? '' },
      marks: true,
    };
  }
  return { args: [], env: {}, marks: false };
}

/** A command line as the shell sent it in OSC 633;E: \\ is a backslash, \xNN a byte. */
export const unescapeLine = (s: string) =>
  s.replace(/\\\\|\\x([0-9a-fA-F]{2})/g, (_m, h) => (h ? String.fromCharCode(parseInt(h, 16)) : '\\'));
