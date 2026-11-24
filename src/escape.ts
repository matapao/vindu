// Text and data written into markup or code Vindu makes itself (its pages, its SVG, what a page check runs). Nothing
// else here.

/** Text as HTML or SVG text content: no markup, no entity. */
export const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A value as JSON inside a <script>, or as a literal in code run in a page: no "<", so nothing in it can close a script
 *  or open a comment wherever that code ends up. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
