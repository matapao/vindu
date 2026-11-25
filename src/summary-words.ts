// What a card says of what it holds in one line (panel-summary.ts), for a host that draws views as cards and for the
// shell's own cards: part of the words a view is drawn in (view-words.ts). A word with a slot in braces ({count}) gets
// its value there: a number or a date as the view's locale writes it. A host's own word keeps the same slots.

/** One line of what a panel holds, by what it holds. */
export type SummaryWords = {
  rows: string; row: string;          // "{count} rows", "1 row"
  total: string;                      // "total {amount}": a table's money column, added up
  highest: string;                    // "highest {what}": a bar chart's tallest bar
  last: string;                       // "last {value}": a line chart's last value
  up: string; down: string; level: string; // the direction of that value since the one before
  events: string; event: string;      // "{count} events", "1 event"
  next: string;                       // "next: {what}": the next event
  to: string;                         // "To {to}": a mail drafted for the person to send
  noSubject: string;                  // a mail without a subject
  sent: string;                       // a draft that is sent
  messages: string; message: string;  // "{count} messages", "1 message"
  due: string;                        // "{amount} due": an invoice's total due
  open: string;                       // "{count} open": tasks not done
  allDone: string;                    // every task done
  nextDue: string;                    // "next due {date}: {what}"
  items: string; item: string;        // a gallery's pictures and videos
  places: string; place: string;      // a map's places, with their labels after them
  pages: string; page: string;        // a PDF's pages, once known
  span: string;                       // "{min} to {max}": a forecast's temperatures
  from: string;                       // "from {when}": when a warning begins
  yellow: string; orange: string; red: string; // a warning's level
  waiting: string;                    // a panel that waits for its result
  failed: string;                     // "failed: {why}": a panel whose call failed
};

export const SUMMARY_WORDS: SummaryWords = {
  rows: '{count} rows', row: '1 row',
  total: 'total {amount}',
  highest: 'highest {what}',
  last: 'last {value}',
  up: 'up', down: 'down', level: 'level',
  events: '{count} events', event: '1 event',
  next: 'next: {what}',
  to: 'To {to}',
  noSubject: '(no subject)',
  sent: 'sent',
  messages: '{count} messages', message: '1 message',
  due: '{amount} due',
  open: '{count} open',
  allDone: 'all done',
  nextDue: 'next due {date}: {what}',
  items: '{count} items', item: '1 item',
  places: '{count} places', place: '1 place',
  pages: '{count} pages', page: '1 page',
  span: '{min} to {max}',
  from: 'from {when}',
  yellow: 'Yellow', orange: 'Orange', red: 'Red',
  waiting: 'waiting',
  failed: 'failed: {why}',
};

export const SUMMARY_WORDS_NB: SummaryWords = {
  rows: '{count} rader', row: '1 rad',
  total: 'sum {amount}',
  highest: 'høyest {what}',
  last: 'sist {value}',
  up: 'opp', down: 'ned', level: 'uendret',
  events: '{count} avtaler', event: '1 avtale',
  next: 'neste: {what}',
  to: 'Til {to}',
  noSubject: '(uten emne)',
  sent: 'sendt',
  messages: '{count} meldinger', message: '1 melding',
  due: '{amount} å betale',
  open: '{count} åpne',
  allDone: 'alt er gjort',
  nextDue: 'neste frist {date}: {what}',
  items: '{count} elementer', item: '1 element',
  places: '{count} steder', place: '1 sted',
  pages: '{count} sider', page: '1 side',
  span: '{min} til {max}',
  from: 'fra {when}',
  yellow: 'Gult', orange: 'Oransje', red: 'Rødt',
  waiting: 'venter',
  failed: 'feilet: {why}',
};

export const SUMMARY_WORDS_NN: SummaryWords = {
  rows: '{count} rader', row: '1 rad',
  total: 'sum {amount}',
  highest: 'høgast {what}',
  last: 'sist {value}',
  up: 'opp', down: 'ned', level: 'uendra',
  events: '{count} avtalar', event: '1 avtale',
  next: 'neste: {what}',
  to: 'Til {to}',
  noSubject: '(utan emne)',
  sent: 'sendt',
  messages: '{count} meldingar', message: '1 melding',
  due: '{amount} å betale',
  open: '{count} opne',
  allDone: 'alt er gjort',
  nextDue: 'neste frist {date}: {what}',
  items: '{count} element', item: '1 element',
  places: '{count} stader', place: '1 stad',
  pages: '{count} sider', page: '1 side',
  span: '{min} til {max}',
  from: 'frå {when}',
  yellow: 'Gult', orange: 'Oransje', red: 'Raudt',
  waiting: 'ventar',
  failed: 'feila: {why}',
};
