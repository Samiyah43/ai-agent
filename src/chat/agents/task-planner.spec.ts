import OpenAI from 'openai';
import { createPlan, looksMultiStep } from './task-planner';

describe('looksMultiStep', () => {
  it.each([
    'Calculate 15% tip on 2500, then search the latest USD to PKR rate',
    'What is the weather in Lahore? Also tell me a joke.',
    'First calculate 2 + 2, and then tell me a joke',
    'Search the latest AI news, after that summarize it',
  ])('detects multi-step connectors in: %s', (message) => {
    expect(looksMultiStep(message)).toBe(true);
  });

  it.each(['What is 2 + 2?', 'Hello, how are you?', "What's the weather in Lahore?", 'Compare X and Y'])(
    'does not flag an ordinary single-topic message: %s',
    (message) => {
      expect(looksMultiStep(message)).toBe(false);
    },
  );
});

describe('createPlan', () => {
  function createFakeClient(create: jest.Mock): OpenAI {
    return { chat: { completions: { create } } } as unknown as OpenAI;
  }

  it('returns the steps submitted via the submit_plan tool call', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'submit_plan',
                  arguments: JSON.stringify({ steps: ['Calculate 15% tip on 2500', 'Search latest USD/PKR rate'] }),
                },
              },
            ],
          },
        },
      ],
    });

    const steps = await createPlan(createFakeClient(create), 'gpt-5-mini', 'tip then rate');

    expect(steps).toEqual(['Calculate 15% tip on 2500', 'Search latest USD/PKR rate']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ tool_choice: { type: 'function', function: { name: 'submit_plan' } } }),
    );
  });

  it('caps the number of steps at 5', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'submit_plan',
                  arguments: JSON.stringify({ steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
                },
              },
            ],
          },
        },
      ],
    });

    const steps = await createPlan(createFakeClient(create), 'gpt-5-mini', 'many steps');

    expect(steps).toHaveLength(5);
  });

  it('falls back to a single step when no tool call is returned', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'just a reply' } }] });

    const steps = await createPlan(createFakeClient(create), 'gpt-5-mini', 'ordinary message');

    expect(steps).toEqual(['ordinary message']);
  });

  it('falls back to a single step when the tool call arguments are malformed JSON', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [{ type: 'function', function: { name: 'submit_plan', arguments: 'not json' } }],
          },
        },
      ],
    });

    const steps = await createPlan(createFakeClient(create), 'gpt-5-mini', 'ordinary message');

    expect(steps).toEqual(['ordinary message']);
  });

  it('falls back to a single step when the request itself throws', async () => {
    const create = jest.fn().mockRejectedValue(new Error('network error'));

    const steps = await createPlan(createFakeClient(create), 'gpt-5-mini', 'ordinary message');

    expect(steps).toEqual(['ordinary message']);
  });
});
