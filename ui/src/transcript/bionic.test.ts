import { describe, expect, it } from 'vitest';
import { bionicMarks } from './bionic.ts';

describe('bionic reading', () => {
  it('bolds the first part of each word and leaves short words and spacing alone', () => {
    expect(bionicMarks('reading words quickly')).toBe('*rea*ding *wo*rds *qui*ckly');
    expect(bionicMarks('a to the')).toBe('a *t*o *t*he');
    expect(bionicMarks('one  two\nthree')).toBe('*o*ne  *t*wo\n*th*ree');
  });

  it('skips leading punctuation when choosing the bold prefix', () => {
    expect(bionicMarks('"quoted" (paren)')).toBe('*"quo*ted" *(pa*ren)');
    expect(bionicMarks('x')).toBe('x');
    expect(bionicMarks('')).toBe('');
  });
});
