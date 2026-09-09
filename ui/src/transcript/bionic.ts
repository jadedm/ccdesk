// Bionic reading: bold the first part of each word so the eye lands on the start and
// completes the rest. Applied to plain text nodes only; code and links are left alone by
// the caller.

import { createElement, type ReactNode } from 'react';

const prefixLength = (word: string): number => {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (letters <= 1) return 0;
  if (letters <= 3) return 1;
  return Math.ceil(letters * 0.4);
};

/** Splits text into alternating [bold, rest] pairs per word, as React nodes. */
export const bionicNodes = (text: string): ReactNode[] => {
  const out: ReactNode[] = [];
  const parts = text.split(/(\s+)/);
  parts.forEach((part, i) => {
    if (part === '' ) return;
    if (/^\s+$/.test(part)) {
      out.push(part);
      return;
    }
    const n = prefixLength(part);
    if (n === 0) {
      out.push(part);
      return;
    }
    // Count letters, skipping leading punctuation such as quotes or brackets.
    let seen = 0;
    let cut = 0;
    for (const ch of part) {
      cut += ch.length;
      if (/[\p{L}\p{N}]/u.test(ch)) seen++;
      if (seen === n) break;
    }
    out.push(createElement('b', { key: i, className: 'bio' }, part.slice(0, cut)), part.slice(cut));
  });
  return out;
};

/** Plain-string form for tests: bold spans marked with asterisks. */
export const bionicMarks = (text: string): string =>
  bionicNodes(text)
    .map((node) => (typeof node === 'string' ? node : `*${(node as { props: { children: string } }).props.children}*`))
    .join('');
