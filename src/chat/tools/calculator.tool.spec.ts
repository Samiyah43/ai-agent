import { runCalculator } from './calculator.tool';

describe('runCalculator', () => {
  it('evaluates a simple expression', () => {
    expect(runCalculator('2 + 2')).toBe('4');
  });

  it('respects operator precedence and parentheses', () => {
    expect(runCalculator('12 * (3 + 4)')).toBe('84');
  });

  it('handles decimals', () => {
    expect(runCalculator('7.5 / 2')).toBe('3.75');
  });

  it('rejects expressions with disallowed characters', () => {
    expect(runCalculator('process.exit()')).toBe(
      'Error: expression contains characters that are not allowed.',
    );
  });

  it('rejects malformed expressions', () => {
    expect(runCalculator('2 + * 3')).toBe('Error: could not evaluate that expression.');
  });
});
