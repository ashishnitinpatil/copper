// Sums typed on the Add keypad: "120+35.5", "3×40", "100÷3". × and ÷ go before
// + and −, as on a calculator. Kept pure so it can be tested without the page.

export const OPERATORS = ['+', '−', '×', '÷'] as const;

export const isOperator = (ch: string) => (OPERATORS as readonly string[]).includes(ch);

/** Whether `expr` has a sum in it, not just a number. */
export const hasOperator = (expr: string) => [...expr].some(isOperator);

/**
 * The value of `expr`, or null when it can't be worked out (dividing by zero).
 * A trailing operator is ignored, so "120+" is 120 while the next number is typed.
 */
export function evaluate(expr: string): number | null {
  const tokens = expr.split(/([+−×÷])/).filter((t) => t !== '');
  if (tokens.length && isOperator(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0) return null;
  // Multiply and divide first, leaving terms to add up.
  const terms: number[] = [];
  let sign = 1;
  let current = Number(tokens[0]);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = Number(tokens[i + 1]);
    if (op === '×') current *= n;
    else if (op === '÷') {
      if (n === 0) return null;
      current /= n;
    } else {
      terms.push(sign * current);
      sign = op === '+' ? 1 : -1;
      current = n;
    }
  }
  terms.push(sign * current);
  const total = terms.reduce((a, b) => a + b, 0);
  return Number.isFinite(total) ? total : null;
}
