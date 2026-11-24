import type { Account } from '../account.js';
import { fitSlot, fixedOf, type Slot, waitingPanel } from '../templates.js';
import { Refusal } from '../view-context.js';
import { answered, drawAsk, openAsk } from './asks.js';
import type { OpenMore } from './contracts.js';
import { keep, log, unawaited } from './records.js';
import type { Fill, Pending, Session } from './state.js';
import { shownAnew } from './view-state.js';
import { asText } from '../format.js';

/** What the model sends for a slot that is the template's, not the model's: where its pane goes, what runs on it, and
 *  what the system shows of it later. Left out, and said. */
const TEMPLATES_OWN = ['place', 'hooks', 'steps', 'suggestions', 'after'] as const;
/** Each fill of the model's that waits for the person's yes, and that ask: a new fill of the slot takes it away. */
const approving = new WeakMap<Fill, Pending>();

// ── static views ──────────────────────────────────────────────────────────────────────────────────────────────
export const slotsOf = (session: Session) =>
  session.mode
    ? {
        static: `the template "${session.mode.template.name}": fill its slots (show_view with "slot"); the panes and layout are the template's`,
        slots: Object.entries(session.mode.template.slots).map(([n, sl]) => {
          const f = session.mode!.fills.get(n);
          return {
            slot: n,
            block: sl.block === 'choose' ? `one of ${sl.of!.join(', ')}` : sl.block,
            ...(sl.needs ? { needs: sl.needs } : {}),
            filled: f
              ? `by ${f.by === 'source' ? `its source${f.id ? ` (${f.id})` : ''}` : f.by === 'person' ? 'the person' : 'you'}`
              : 'no',
            ...(f?.failed ? { failed: f.failed } : {}),
            ...(sl.required && !f ? { required: true } : {}),
            ...(f?.approved ? { approved_by: f.approved } : {}),
            ...(f?.declined ? { approved: false } : {}),
            ...(sl.then && f?.by === 'model' && !f.approved && !f.declined
              ? {
                  waiting: `for ${sl.then.approve ?? 1} ${(sl.then.approve ?? 1) > 1 ? 'people' : 'person'} to approve`,
                }
              : {}),
          };
        }),
      }
    : {};
/** The model fills a slot: what it sent is made to fit the slot, shown in the slot's pane, and passed on if it must be approved. */
export const fillSlot = async (session: Session, args: Record<string, unknown>) => {
  const m = session.mode!;
  const name = asText(args.slot ?? args.name ?? '');
  const slot = Object.hasOwn(m.template.slots, name) ? m.template.slots[name] : undefined;
  if (!slot)
    throw new Refusal(
      `this task uses the static view "${m.template.name}": fill one of its slots (slot: …): ${Object.keys(m.template.slots).join(', ')}`,
    );
  const theirs = TEMPLATES_OWN.filter((k) => args[k] !== undefined);
  const mine = Object.fromEntries(
    Object.entries(args).filter(([k]) => !(TEMPLATES_OWN as readonly string[]).includes(k)),
  );
  const fit = fitSlot(name, slot, mine); // a browser page, or a slot the person fills, is refused here
  if ('refusal' in fit) throw new Refusal(fit.refusal);
  const had = m.fills.get(name);
  if (had?.by === 'source' && !had.failed)
    throw new Refusal(
      `slot ${name} (${slot.title}) is filled from its source, which the system reads; it is not yours to fill`,
    );
  if (had?.by === 'person' || had?.approved)
    throw new Refusal(
      `slot ${name} (${slot.title}) is ${had.approved ? `approved, by ${had.approved.join(', ')}` : 'filled by the person'}; it stays as it is`,
    );
  const fill: Fill = { by: 'model', at: new Date().toISOString() };
  const acc = (await session.present(fit.args, false, false, () => {
    shownAnew(session, name);
    const waiting = had && approving.get(had); // a fill that waited for a yes is gone: so is its ask
    if (waiting && session.asks.get(waiting.ask.ticket) === waiting) answered(session, waiting, { action: 'cancel' });
    m.fills.set(name, fill);
  })) as Account & { slot?: string };
  acc.slot = name;
  const notes = [
    ...fit.notes,
    ...(theirs.length ? [`slot ${name}: ${theirs.join(', ')} are the template's, so they were left out`] : []),
  ];
  if (notes.length) acc.corrections = [...(acc.corrections ?? []), ...notes];
  if (slot.then) unawaited(session, { slot: name, approve: true }, thenAsk(session, name, slot, fit.args, fill));
  log(session, { tool: 'show_view', ok: true, slot: name, args, account: acc });
  return acc;
};
/** What the model filled goes to the person next: to approve (by n people), or to change and approve. A yes is to this
 *  fill only: once the model fills the slot again, the ask is taken away. */
const thenAsk = async (
  session: Session,
  name: string,
  slot: Slot,
  args: Record<string, unknown>,
  fill: Fill,
) => {
  if (session.mode?.fills.get(name) !== fill) return; // filled again while it was drawn: the newer fill is asked
  const then = slot.then!;
  const text0 =
    ((args.panels as Record<string, unknown>[] | undefined)?.[0]?.text as string | undefined) ?? '';
  const edit = then.edit && typeof text0 === 'string' && text0 !== '';
  const p = openAsk(
    session,
    'operation',
    `approve ${name}`,
    {
      title: `${edit ? 'Read, change if need be, and approve' : 'Approve'}: ${slot.title}`,
      message: `The model filled "${slot.title}". It goes no further until ${(then.approve ?? 1) > 1 ? `${then.approve} people approve it` : 'you approve it'}.`,
      ...(edit
        ? {
            fields: { text: { type: 'string', title: slot.title, default: text0, long: true } },
            required: ['text'],
          }
        : {}),
    },
    undefined,
    !edit,
  );
  p.need = Math.max(1, then.approve ?? 1);
  if (p.need > 1) {
    p.ask = { ...p.ask, need: p.need, approvals: [] };
    drawAsk(session, p);
  }
  approving.set(fill, p);
  const r = await p.outcome;
  approving.delete(fill);
  const f = session.mode?.fills.get(name);
  if (!f || f !== fill) return; // filled again since: this yes or no was to what is no longer there
  if (r.action !== 'accept') {
    f.declined = true;
    keep(session, { to: `slot ${name}`, by: 'person', values: null });
    session.shell.tell(`did not approve slot ${name} (${slot.title})`);
    return;
  }
  f.approved = p.approvals.map((a) => a.name);
  const edited = edit && r.values.text !== text0 ? String(r.values.text) : undefined;
  const e = keep(session, {
    to: `slot ${name}`,
    by: 'person',
    values: edited !== undefined ? { text: edited } : { approved: true },
    who: p.approvals.map((a) => `${a.name} (${a.window})`),
  });
  if (edited !== undefined) {
    await session
      .present({
        name,
        title: slot.title,
        panels: [{ id: 'text', card: 'text', from: e.id, pick: 'text' }],
      })
      .catch((x) => log(session, { slot: name, refused: String((x as Error).message) }));
    f.by = 'person';
    f.id = e.id;
  }
  session.shell.tell(
    `approved slot ${name} (${slot.title})${edited !== undefined ? ', after changing it' : ''}`,
  );
};
/** A slot the person fills: a form, or what they capture with the host's own way to (attachments). */
export const personSlot = async (session: Session, name: string, slot: Slot, more: OpenMore) => {
  const a = slot.ask!;
  const m = session.mode!;
  if (a.capture) {
    if (!more.capture) {
      await session
        .present({
          name,
          title: slot.title,
          panels: [waitingPanel(slot, 'This window cannot capture: attach the files in the chat')],
        })
        .catch(() => undefined);
      return;
    }
    const got = await more
      .capture({ slot: name, kind: a.capture, min: a.min, max: a.max, about: a.about ?? slot.needs })
      .catch(() => [] as string[]);
    const ids = Array.isArray(got) ? got : got.ids;
    const by = Array.isArray(got) ? undefined : got.by;
    if (!ids.length) return;
    const e = keep(session, {
      to: `slot ${name}`,
      by: 'person',
      values: { files: ids },
      ...(by ? { who: [`${by.name} (${by.window})`] } : {}),
    });
    await session
      .present({
        name,
        title: slot.title,
        panels: ids.map((id, i) => ({ id: `${a.capture}-${i + 1}`, card: 'media', media: id })),
      })
      .catch((x) => log(session, { slot: name, refused: String((x as Error).message) }));
    m.fills.set(name, { by: 'person', id: e.id, at: new Date().toISOString() });
    session.shell.tell(
      `added ${ids.length} ${a.capture === 'photo' ? 'photos' : 'files'} to slot ${name} (${ids.join(', ')})`,
    );
    return;
  }
  const p = openAsk(
    session,
    'operation',
    `fill ${name}`,
    {
      title: slot.title,
      ...(a.about ? { message: a.about } : {}),
      fields: a.fields,
      required: Object.keys(a.fields ?? {}),
    },
    undefined,
    false,
  );
  const r = await p.outcome;
  if (r.action !== 'accept') return;
  const e = keep(session, {
    to: `slot ${name}`,
    by: 'person',
    values: r.values,
    who: p.approvals.map((x) => `${x.name} (${x.window})`),
  });
  const block = ['record', 'table', 'money', 'contacts', 'tasks', 'events'].includes(slot.block)
    ? slot.block
    : 'record';
  await session
    .present({
      name,
      title: slot.title,
      panels: [{ id: 'answer', card: block, from: e.id, ...fixedOf(slot) }],
    })
    .catch((x) => log(session, { slot: name, refused: String((x as Error).message) }));
  m.fills.set(name, { by: 'person', id: e.id, at: new Date().toISOString() });
};
