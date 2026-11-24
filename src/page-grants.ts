// What a page from the working folder may read. Such a page runs apart from the task's data, on an origin for the
// results the model gave it (its uses): http://work-<key>-<grant>.localhost, where the grant is the page host's
// signature of those uses (http://work-<key>.localhost for none). A page there reads only them. It cannot sign
// others, so asking with other uses gets nothing, and pages given other uses are on other origins, out of its reach
// even beside it in the window. A grant is for one process and one list of uses. It is 96 bits of an HMAC: a process
// key is 128, and one name (a DNS label) holds 63 characters at most, which work-<key>-<grant> fills to 62.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A grant's length in hex digits. */
export const GRANT_LENGTH = 24;

export function pageGrants(secret: Buffer = randomBytes(32)) {
  const sign = (key: string, uses: readonly string[]) => createHmac('sha256', secret).update(`${key}\n${uses.join(',')}`).digest('hex').slice(0, GRANT_LENGTH);
  return {
    /** The host name of the work origin for these uses. */
    name: (key: string, uses: readonly string[]) => `work-${key}${uses.length ? `-${sign(key, uses)}` : ''}`,
    /** The uses a request names when the work origin it came to (its grant) is theirs; none otherwise. */
    granted(key: string, uses: string[], grant: string | undefined): string[] {
      const want = Buffer.from(sign(key, uses)), got = Buffer.from(grant ?? '');
      return uses.length && got.length === want.length && timingSafeEqual(got, want) ? uses : [];
    },
  };
}
export type PageGrants = ReturnType<typeof pageGrants>;
