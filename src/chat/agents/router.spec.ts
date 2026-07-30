import { generalAgent } from './general.agent';
import { mathDataAgent } from './math-data.agent';
import { researchAgent } from './research.agent';
import { routeToAgent } from './router';

describe('routeToAgent', () => {
  it('routes arithmetic expressions to the math-data agent', () => {
    expect(routeToAgent('What is 2 + 2?')).toBe(mathDataAgent);
    expect(routeToAgent('10 * 5')).toBe(mathDataAgent);
  });

  it('routes calculation keywords to the math-data agent', () => {
    expect(routeToAgent('Can you calculate the total for me?')).toBe(mathDataAgent);
    expect(routeToAgent('What percentage is 20 of 80?')).toBe(mathDataAgent);
  });

  it('routes spelled-out arithmetic (e.g. "times") to the math-data agent', () => {
    expect(routeToAgent('What is 12 times 8?')).toBe(mathDataAgent);
    expect(routeToAgent('5 plus 3')).toBe(mathDataAgent);
  });

  it('routes weather questions to the math-data agent', () => {
    expect(routeToAgent('What is the weather in Karachi?')).toBe(mathDataAgent);
    expect(routeToAgent('Lahore ka mausam kaisa hai?')).toBe(mathDataAgent);
  });

  it('routes greetings and small talk to the general agent', () => {
    expect(routeToAgent('Hi, how are you?')).toBe(generalAgent);
    expect(routeToAgent('Salam!')).toBe(generalAgent);
    expect(routeToAgent('Thanks a lot!')).toBe(generalAgent);
    expect(routeToAgent('Who are you?')).toBe(generalAgent);
  });

  it('falls back to the research agent for factual/knowledge/current-info questions', () => {
    expect(routeToAgent("What is our company's leave policy?")).toBe(researchAgent);
    expect(routeToAgent('Compare ChatGPT, Claude and Gemini')).toBe(researchAgent);
    expect(routeToAgent('What is the capital of France?')).toBe(researchAgent);
  });
});
