import { describe, expect, it } from 'vitest';
import { evaluate, hasOperator } from './calc';

describe('evaluate', () => {
  it('adds and subtracts left to right', () => {
    expect(evaluate('120+35.5')).toBe(155.5);
    expect(evaluate('100−30+5')).toBe(75);
  });

  it('multiplies and divides before adding', () => {
    expect(evaluate('2+3×4')).toBe(14);
    expect(evaluate('100−20÷4')).toBe(95);
  });

  it('ignores an operator still waiting for its number', () => {
    expect(evaluate('120+')).toBe(120);
  });

  it('has no answer for dividing by zero', () => {
    expect(evaluate('5÷0')).toBeNull();
  });

  it('is just the number when there is no sum', () => {
    expect(evaluate('42.5')).toBe(42.5);
    expect(hasOperator('42.5')).toBe(false);
    expect(hasOperator('4+2')).toBe(true);
  });
});
