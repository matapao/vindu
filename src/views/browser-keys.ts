// Keys as a browser view presses them (browser.ts): a key, or a key with modifiers ("Enter", "Control+a", "Shift+Tab"),
// as the key events CDP dispatches, and whether it types and whether it only moves on from the focused field.
const KEYS: Record<string, [string, number, string?]> = {
  // key: code, Windows key code, text it types
  Enter: ['Enter', 13, '\r'],
  Tab: ['Tab', 9],
  Escape: ['Escape', 27],
  Backspace: ['Backspace', 8],
  Delete: ['Delete', 46],
  Space: ['Space', 32, ' '],
  ArrowUp: ['ArrowUp', 38],
  ArrowDown: ['ArrowDown', 40],
  ArrowLeft: ['ArrowLeft', 37],
  ArrowRight: ['ArrowRight', 39],
  Home: ['Home', 36],
  End: ['End', 35],
  PageUp: ['PageUp', 33],
  PageDown: ['PageDown', 34],
};
const MODS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 };

/** A key, or a key with modifiers: its code, Windows key code and the text it types (none with Control or Meta), and
 *  whether it only moves on from the field it is in (Tab, Shift+Tab, Escape, Enter). */
export function keyOf(combo: string): {
  key: string;
  code: string;
  vk: number;
  text?: string;
  modifiers: number;
  typing: boolean;
  movesOn: boolean;
} {
  const parts = combo.split('+');
  const key = parts.pop()!;
  let modifiers = 0;
  for (const m of parts) {
    if (!Object.hasOwn(MODS, m)) throw new Error(`no modifier "${m}": use Alt, Control, Meta or Shift`);
    modifiers |= MODS[m];
  }
  const k =
    (Object.hasOwn(KEYS, key) ? KEYS[key] : undefined) ??
    (key.length === 1
      ? ([
          key.toUpperCase() === key.toLowerCase() ? `Digit${key}` : `Key${key.toUpperCase()}`,
          key.toUpperCase().charCodeAt(0),
          key,
        ] as [string, number, string])
      : undefined);
  if (!k) throw new Error(`no key "${key}": a character, or one of ${Object.keys(KEYS).join(', ')}`);
  const [code, vk, text] = k;
  const typing = text !== undefined && !(modifiers & (2 | 4));
  const movesOn =
    (key === 'Tab' && (modifiers === 0 || modifiers === MODS.Shift)) ||
    ((key === 'Escape' || key === 'Enter') && modifiers === 0);
  return { key, code, vk, text, modifiers, typing, movesOn };
}
