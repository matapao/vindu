// A1 addresses of the cells a table or a sheet draws: columns by letters (A, B, … Z, AA, …), rows by number, row 1 the
// header row. Shared by the server, which checks the model's notes against them, and the window, which draws them, so
// nothing is imported here.

/** A cell address as the model writes one: one to three capital letters, then a row number from 1. */
const CELL_ADDRESS = /^[A-Z]{1,3}[1-9]\d{0,5}$/;

/** A column's letters by its place, from 0: A to Z, then AA, AB, … */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A column's place, from 0, by its letters. */
function columnIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64;
  return n - 1;
}

/** A cell by its address: its column's place (from 0) and its row's number (from 1, the header row); null when the
 *  address is not one. */
export function cellAt(address: string): { column: number; row: number } | null {
  if (!CELL_ADDRESS.test(address)) return null;
  const letters = /^[A-Z]+/.exec(address)![0];
  return { column: columnIndex(letters), row: Number(address.slice(letters.length)) };
}
