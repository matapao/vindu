// Other sites, for the model's browser pages. Pages run in the app, outside the processor's sandbox, so what an address
// holds goes to its site: this machine's addresses open at once, and any other site only on the person's yes, once per
// site, kept until the task ends. The model may ask for an address itself (show_view, go_to) again after a no; what a
// page reaches for by itself (its frames, scripts, images, fetches, a move to another site) is asked one question at a
// time, a request to a site already being asked about waits for that answer, and a site the person refused stays refused.

type Question = { title: string; message?: string; details?: { label?: string; text: string }[] };
type Confirm = (q: Question, signal?: AbortSignal) => Promise<boolean>;

/** This machine: what a page of the model's opens without asking. Every port counts, and every *.localhost name (which
 *  the browser keeps on this machine): a host whose own app answers here without a sign-in (its window's server, a local
 *  API that trusts its own origin) leaves those addresses out with BrowserSetup.local. */
export const isLocal = (u: URL) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost');

/** What a page may reach without the network (data: and blob: addresses, and the browser's blank and srcdoc pages). */
const NO_NETWORK = /^(data|blob|about):$/;
const WEB = /^(https?|wss?):$/;

export class Sites {
  private readonly allowed = new Set<string>(); // origins the person let the model's pages reach
  private readonly refused = new Set<string>(); // origins the person did not
  private readonly open = new Map<string, Promise<boolean>>(); // the question being asked, or waiting, for each origin
  private queue: Promise<unknown> = Promise.resolve(); // what pages reach for by themselves: one question at a time

  constructor(
    private readonly local: (u: URL) => boolean,
    private readonly confirm: Confirm,
    private readonly log: (e: Record<string, unknown>) => void,
  ) {}

  /** Whether an address opens without asking: this machine's, or a site the person allowed in this process. */
  allowedNow(url: string): boolean {
    try {
      const u = new URL(url);
      return u.href === 'about:blank' || this.local(u) || this.allowed.has(u.origin);
    } catch {
      return false;
    }
  }

  /** The model asks for an address (show_view, go_to): the person is asked each time, until a yes. A question already
   *  open for the site is answered first. */
  async allow(url: string, question: Question, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    if (this.allowedNow(url)) return true;
    const u = new URL(url);
    const open = this.open.get(u.origin);
    if (open) {
      const yes = await open;
      if (signal?.aborted) return false;
      if (yes) return true;
    }
    return this.track(u.origin, this.ask(u, question, signal));
  }

  /** A page reaches for an address by itself. undefined: it may, at once. false: it may not (a site the person refused,
   *  an address that is not on the web, or no ask to make). Otherwise the person's answer for the site. The question
   *  is made when its turn comes; none then (the page may no longer ask) is a no. */
  reach(
    url: string,
    ask?: { question: () => Question | undefined; signal: AbortSignal },
  ): Promise<boolean> | false | undefined {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (!WEB.test(u.protocol)) return NO_NETWORK.test(u.protocol) ? undefined : false;
    if (this.allowedNow(url)) return undefined;
    if (this.refused.has(u.origin) || !ask || ask.signal.aborted) return false;
    const { question, signal } = ask;
    const open = this.open.get(u.origin);
    if (open) return open.then((yes) => yes && !signal.aborted);
    const turn = this.queue.then(async () => {
      // the answer to the question before may have settled this one
      if (this.allowedNow(url)) return true;
      const asked = this.refused.has(u.origin) || signal.aborted ? undefined : question();
      return asked ? this.ask(u, asked, signal) : false;
    });
    this.queue = turn.catch(() => false);
    return this.track(u.origin, turn);
  }

  private async ask(u: URL, question: Question, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    let yes = false;
    try {
      yes = (await this.confirm(question, signal)) && !signal?.aborted;
    } catch {
      yes = false;
    }
    this.log({ site: u.origin, address: u.href, asked: true, yes });
    if (yes) {
      this.allowed.add(u.origin);
      this.refused.delete(u.origin);
    } else if (!signal?.aborted) this.refused.add(u.origin);
    return yes;
  }
  private track(origin: string, answer: Promise<boolean>): Promise<boolean> {
    this.open.set(origin, answer);
    answer
      .finally(() => {
        if (this.open.get(origin) === answer) this.open.delete(origin);
      })
      .catch(() => undefined);
    return answer;
  }
}
