import OpenAI from 'openai';

export const calculatorToolDefinition: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'calculator',
    description:
      'Evaluates a basic arithmetic expression (+, -, *, /, parentheses, decimals). Use this whenever the user asks for a calculation instead of computing it yourself.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The math expression to evaluate, e.g. "12 * (3 + 4)"',
        },
      },
      required: ['expression'],
    },
  },
};

export function runCalculator(expression: string): string {
  if (!/^[0-9+\-*/(). \s]+$/.test(expression)) {
    return 'Error: expression contains characters that are not allowed.';
  }

  try {
    // Safe here because the regex above only allows digits, whitespace, and + - * / ( ) .
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const result = new Function(`"use strict"; return (${expression});`)() as unknown;

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return 'Error: the expression did not evaluate to a valid number.';
    }

    return String(result);
  } catch {
    return 'Error: could not evaluate that expression.';
  }
}
