// Money as a document: an invoice or a receipt (its head, its lines, the totals the system added up, and whether the
// document's own total is what its lines add up to), or one payment before it is made. Its labels are the view's
// words; a field of its head that is none of the usual ones is labelled by its name, made readable. Its lines scroll
// sideways in a narrow pane: a number is never wrapped, and text wraps at its spaces alone (an amount's own spaces
// are no-break spaces, as the locale writes them).
import { html, nothing } from 'lit';
import { BLOCK_WORDS, wordsGiven, wordWith, type MoneyWords } from '../../block-words.js';
import { readableName } from '../../field-names.js';
import { asText, moneyIn } from '../../format.js';
import { unbroken } from './cells.js';
import { type BlockRow, defineBlock, fieldValue, formatCell, formatTime, rowContainer } from './shared.js';

/** The usual fields of a document's head, by their names, each labelled with its word. */
const HEAD: [keyof MoneyWords, RegExp][] = [
  ['number', /^(number|no|nr|num|id|ref|reference|(invoice|receipt|order)_?(number|no|nr|id)?|nummer|fakturan(umme)?r)$/i],
  ['customer', /^(customer|customer_?name|client|buyer|to|bill_?to|recipient|kunde|kundenavn)$/i],
  ['date', /^(date|invoice_?date|issued|issue_?date|issued_?at|dato|fakturadato)$/i],
  ['due', /^(due|due_?date|due_?at|payment_?due|forfall|forfallsdato)$/i],
  ['currency', /^(currency|ccy|valuta)$/i],
];
/** A payment's usual fields: those of a document's head but its customer, as whom a payment goes to is not one. */
const PAYMENT = HEAD.filter(([word]) => word !== 'customer');
/** A field of a date, by its name. */
const DATED = /date|due|dato|forfall/i;

/** A field's label: its word, where it is one of the usual fields, or its name made readable, with a capital. */
function labelOf(field: string, words: MoneyWords, usualFields = HEAD): string {
  const usual = usualFields.find(([, name]) => name.test(field))?.[0];
  if (usual) return words[usual];
  const readable = readableName(field);
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
/** A pair of a label and its value, as the head and a payment draw each field. */
const pair = (label: string, value: unknown) => html`<div class="vb-kv"><span>${label}</span><span>${value}</span></div>`;

export const VMoney = defineBlock(
  'VMoney',
  'vindu-money',
  { currency: 'string', head: 'value', totals: 'value', words: 'value' },
  (props) => {
    const rows = props.rows;
    const words = wordsGiven(props.words, BLOCK_WORDS.money);
    const currencyOf = (row?: BlockRow) =>
      asText((row && fieldValue(props, row, 'currency')) || props.currency || '') || undefined;
    const money = (v: unknown, row?: BlockRow) => moneyIn(v, currencyOf(row), props.locale);
    const valueOf = (field: string, v: unknown) => (DATED.test(field) ? formatTime(props, v, false) : unbroken(formatCell(props, v, field)));
    const header = Object.entries((props.head ?? {}) as BlockRow).filter(([k]) => !/^total$/i.test(k));
    const totals = (props.totals ?? {}) as BlockRow;
    if (props.layout === 'payment') {
      const row = rows[0];
      if (!row) return nothing; // no payment to show
      return rowContainer(
        props,
        0,
        'vb-pay',
        html`<div class="vb-big">${money(fieldValue(props, row, 'amount'), row)}</div>${Object.entries(row)
          .filter(([k]) => k !== props.map?.amount && !k.startsWith('__'))
          .map(([k, v]) => pair(labelOf(k, words, PAYMENT), valueOf(k, v)))}`,
      );
    }
    const quantity = !!props.map?.quantity, price = !!props.map?.price;
    const line = (row: BlockRow, index: number) =>
      html`<tr data-panel=${props.panel ?? ''} data-row=${String(index)}><td>${unbroken(formatCell(props, fieldValue(props, row, 'description')))}</td>${
        quantity ? html`<td class="vb-num">${formatCell(props, fieldValue(props, row, 'quantity'))}</td>` : nothing
      }${price ? html`<td class="vb-num">${money(fieldValue(props, row, 'price'), row)}</td>` : nothing}<td class="vb-num">${money(fieldValue(props, row, 'amount'), row)}</td></tr>`;
    const stated = () =>
      totals.agrees
        ? `✓ ${wordWith(words.agrees, { stated: money(totals.stated) })}`
        : `⚠ ${wordWith(words.differs, { stated: money(totals.stated), total: money(totals.total) })}`;
    return html`<div class="vb-money">${
      header.length ? html`<div class="vb-head">${header.map(([k, v]) => pair(labelOf(k, words), valueOf(k, v)))}</div>` : nothing
    }<div class="vb-scroll"><table class="vb-lines"><thead><tr><th>${words.description}</th>${
      quantity ? html`<th class="vb-num">${words.quantity}</th>` : nothing
    }${price ? html`<th class="vb-num">${words.price}</th>` : nothing}<th class="vb-num">${words.amount}</th></tr></thead>
<tbody>${rows.map(line)}</tbody>
<tfoot>${
      totals.vat !== undefined
        ? html`<tr><td colspan="9" class="vb-sum">${words.lines} ${money(totals.lines)} · ${words.vat} ${money(totals.vat)}</td></tr>`
        : nothing
    }<tr><td colspan="9" class="vb-sum vb-total">${words.total} ${money(totals.total)}</td></tr>${
      totals.stated !== undefined
        ? html`<tr><td colspan="9" class=${`vb-sum ${totals.agrees ? 'vb-muted' : 'vb-warn'}`}>${stated()}</td></tr>`
        : nothing
    }</tfoot></table></div></div>`;
  },
);
