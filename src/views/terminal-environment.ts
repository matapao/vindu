// What a terminal's shell gets of the host's environment by default: what a shell needs to start as the person's own
// (who they are, their home and path, how text is written, the display and desktop bus, the agent for their SSH keys,
// the proxy), and nothing else. The host's process may hold credentials (a backend's keys, a processor's tokens), and a
// shared terminal shows the model what its shell holds. The person's own startup files still run in the shell and set the
// rest, as in any terminal they open.

const NAMES = new Set([
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'TERM',
  'COLORTERM',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TMPDIR',
  'ZDOTDIR',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'DBUS_SESSION_BUS_ADDRESS',
  'SSH_AUTH_SOCK',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'FTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  // Windows: no startup file sets these; the system gives them to each program it starts
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'USERNAME',
  'USERDOMAIN',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'TEMP',
  'TMP',
  'OS',
  'COMPUTERNAME',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'NUMBER_OF_PROCESSORS',
  'PSMODULEPATH',
]);
const PREFIXES = ['LC_', 'XDG_'];

/** The variables of source (the host's environment, by default) that a terminal's shell gets: names compared without
 *  case, as Windows compares them, so http_proxy goes as HTTPS_PROXY does. */
export function terminalEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    const upper = name.toUpperCase();
    if (value !== undefined && (NAMES.has(upper) || PREFIXES.some((prefix) => upper.startsWith(prefix))))
      kept[name] = value;
  }
  return kept;
}
