import { describe, expect, it } from 'vitest';
import { bionicMarks } from './bionic.ts';

describe('bionic reading', () => {
  it('bolds the first part of each word and leaves short words and spacing alone', () => {
    expect(bionicMarks('reading words quickly')).toBe('*rea*ding *wo*rds *qui*ckly');
    expect(bionicMarks('a to the')).toBe('a *t*o *t*he');
    expect(bionicMarks('one  two\nthree')).toBe('*o*ne  *t*wo\n*th*ree');
  });

  it('never cuts inside a grapheme: combining marks, vowel signs and joiners stay attached', () => {
    expect(bionicMarks('\u0915\u093f\u0924\u093e\u092c')).toBe('*\u0915\u093f*\u0924\u093e\u092c');
    expect(bionicMarks('e\u0301te\u0301')).toBe('*e\u0301*te\u0301');
    expect(bionicMarks('👩\u200d💻x')).toBe('👩\u200d💻x');
  });

  it('skips leading punctuation when choosing the bold prefix', () => {
    expect(bionicMarks('"quoted" (paren)')).toBe('*"quo*ted" *(pa*ren)');
    expect(bionicMarks('x')).toBe('x');
    expect(bionicMarks('')).toBe('');
  });
});
