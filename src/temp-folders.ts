// What Vindu writes on the computer from results (pictures, a session's records, the pages the model writes, its
// terminals' logs) lives only while what wrote it is open: each folder or file is removed when its session closes, and
// whatever is still there is removed as the process exits. A process killed outright leaves it for the system's own
// clearing of its temporary folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const left = new Set<string>(); // what is removed at exit: the paths not removed yet
let hooked = false;

const removeNow = (at: string): void => {
  try {
    fs.rmSync(at, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // held open elsewhere: the system's own clearing of its temporary folder takes it
  }
};
const removeLeft = (): void => {
  for (const at of left) removeNow(at);
  left.clear();
};

/** A folder or file to remove: now, with the function returned, or as the process exits if it is still there. */
export function removable(at: string): () => void {
  left.add(at);
  if (!hooked) {
    hooked = true;
    process.once('exit', removeLeft);
  }
  return () => {
    left.delete(at);
    removeNow(at);
  };
}

/** A new folder of Vindu's own under parent (the system's temporary folder by default), readable by this user alone. */
export function tempFolder(prefix: string, parent: string = os.tmpdir()): string {
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  fs.chmodSync(dir, 0o700);
  return dir;
}
