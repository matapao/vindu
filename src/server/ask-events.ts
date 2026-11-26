import { readAnswer } from '../operations.js';
import { answered, drawAsk } from './asks.js';
import { log, stableJson, whoOf } from './records.js';
import type { Session } from './state.js';
import { asText } from '../format.js';

// The host registers attachments only while this specific ask and file field are open.
export const provideFiles = (session: Session, ticket: string, field: string, register: () => string[]): string[] => {
  const pending = session.asks.get(ticket);
  if (session.closed || !pending || !Object.hasOwn(pending.ask.fields, field)) return [];
  if (pending.ask.fields[field].format !== 'file' || pending.approvals.length) return []; // what the first yes approved stays as it is
  const ids = register();
  if (!ids.length) return [];
  const names = ids.map((id) => {
    const entry = session.results.get(id);
    return entry?.kind === 'attachment' ? entry.name : id;
  });
  pending.ask = {
    ...pending.ask,
    files: { ...pending.ask.files, [field]: { ids, names } },
    error: undefined,
  };
  drawAsk(session, pending);
  log(session, { person: { picked: ids, for: ticket, field } });
  return ids;
};

export function answerFromWindow(session: Session, x: Record<string, unknown>): boolean {
  const ctx = (x.context ?? {}) as Record<string, unknown>;
  const p = session.asks.get(asText(ctx.ticket ?? ''));
  if (!p || x.view !== p.view) return false;
  if (x.name === 'decline') {
    answered(session, p, { action: 'decline' });
    return true;
  }
  if (x.name === 'pick_file') {
    // a file field: the host's own way to take files, kept as attachments; the ask shows what was picked
    const field = asText(ctx.field ?? '');
    const f = Object.hasOwn(p.ask.fields, field) ? p.ask.fields[field] : undefined;
    if (!f || f.format !== 'file') return false;
    if (p.approvals.length) {
      p.ask = { ...p.ask, error: 'what was submitted is what the others approve: it can no longer be changed' };
      drawAsk(session, p);
      return true;
    }
    if (!session.more.capture) {
      p.ask = { ...p.ask, error: 'this window cannot take files' };
      drawAsk(session, p);
      return true;
    }
    let picking: ReturnType<NonNullable<typeof session.more.capture>>;
    try {
      picking = session.more.capture({
        slot: `${p.ask.op}: ${f.title ?? field}`,
        kind: 'file',
        about: f.description ?? f.title ?? field,
        ...(f.accept ? { accept: f.accept } : {}),
        now: true,
      });
    } catch (error) {
      picking = Promise.reject(error instanceof Error ? error : new Error(String(error))); // a host that fails at once is told in the ask too, not thrown at the window
    }
    void Promise.resolve(picking)
      .then((got) => {
        if (session.asks.get(p.ask.ticket) === p)
          provideFiles(session, p.ask.ticket, field, () => (Array.isArray(got) ? got : got.ids));
      })
      .catch((error) => {
        if (session.closed || session.asks.get(p.ask.ticket) !== p) return;
        p.ask = { ...p.ask, error: String((error as Error).message) };
        drawAsk(session, p);
      });
    return true;
  }
  if (x.name !== 'answer') return false;
  const values = p.ask.choices
    ? { choice: ctx.choice, n: ctx.n }
    : Object.fromEntries(
        Object.entries(ctx)
          .filter(([k]) => k.startsWith('f:'))
          .map(([k, v]) => [k.slice(2), v]),
      );
  const r = readAnswer(p.ask, values, ctx.fileSelection, session.runtime.words);
  if ('error' in r) {
    p.ask = { ...p.ask, error: r.error };
    drawAsk(session, p);
    return true;
  } // back to the person, never to the model
  const who = whoOf(x);
  if (p.approvals.some((a) => a.window === who.window || a.name.toLowerCase() === who.name.toLowerCase())) {
    p.ask = { ...p.ask, error: `${who.name} has said yes already; another person, in another window, must` };
    drawAsk(session, p);
    return true;
  }
  if (p.approvals.length && (stableJson(r.values) !== stableJson(p.values) || r.n !== p.n)) {
    // the first yes's values are what the others approve: a yes to something else is no yes to it
    const what = p.ask.choices ? `chose "${String(p.values?.choice)}"` : `submitted ${JSON.stringify(p.values)}`;
    p.ask = { ...p.ask, error: `${p.approvals[0].name} ${what}: approve exactly that, or decline` };
    drawAsk(session, p);
    return true;
  }
  p.approvals.push({ ...who, at: new Date().toISOString() });
  if (p.approvals.length === 1) {
    p.values = r.values;
    p.n = r.n;
  }
  log(session, { approval: { ticket: p.ask.ticket, ...who, of: p.need } });
  if (p.approvals.length < p.need) {
    const submitted = p.values ?? {};
    p.ask = {
      ...p.ask,
      error: undefined,
      // each one after sees what was submitted, filled in, to approve as it is
      fields: Object.fromEntries(
        Object.entries(p.ask.fields).map(([k, f]) => [
          k,
          Object.hasOwn(submitted, k) && f.format !== 'file' ? { ...f, default: submitted[k] } : f,
        ]),
      ),
      approvals: [...p.approvals],
      details: [
        ...(p.ask.details ?? []).filter((d) => d.label !== 'as submitted'),
        { label: 'as submitted', text: JSON.stringify(p.values) },
      ],
    };
    drawAsk(session, p);
    return true;
  }
  answered(session, p, { action: 'accept', values: p.values!, ...(p.n !== undefined ? { n: p.n } : {}) });
  return true;
}
