import OpenAI from 'openai';

// Same philosophy as needsWebSearch() in research.agent.ts: only pay for an
// extra planning LLM call when the message actually looks like it contains
// more than one distinct request. Ordinary single-topic messages (the vast
// majority) skip this entirely and go through the existing single-agent flow.
const MULTI_STEP_PATTERN =
  /\b(and then|then\b|after that|also,?\s|next,|firstly|secondly|step\s*\d|,\s*then)\b/i;

export function looksMultiStep(message: string): boolean {
  return MULTI_STEP_PATTERN.test(message);
}

// A model can't be trusted to reliably format a plain-text numbered list, but
// it can be forced (via tool_choice) to call this function with a well-formed
// array — same trick used elsewhere in this codebase to get structured output
// out of small/free models.
const SUBMIT_PLAN_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'submit_plan',
    description: "Submit the ordered list of steps the user's request breaks down into.",
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Each step is a single, self-contained instruction that one specialist agent could answer alone. Return just one step if the request is not actually multi-part.',
        },
      },
      required: ['steps'],
    },
  },
};

// Hard cap so a model that misunderstands the instruction (or a pathological
// message) can't blow up a request into dozens of sequential LLM calls.
const MAX_PLAN_STEPS = 5;

// Breaks a multi-part message into an ordered list of self-contained steps.
// Falls back to treating the whole message as a single step whenever the
// model's response can't be trusted — a missing tool call, unparsable JSON,
// or an empty list — so a planning failure never blocks the reply outright,
// it just degrades to the pre-existing single-agent behaviour.
export async function createPlan(
  client: OpenAI,
  model: string,
  message: string,
): Promise<string[]> {
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            "Break the user's request into an ordered list of self-contained steps and call submit_plan with them. Each step must make sense on its own, without needing to see the other steps' wording.",
        },
        { role: 'user', content: message },
      ],
      tools: [SUBMIT_PLAN_TOOL],
      tool_choice: { type: 'function', function: { name: 'submit_plan' } },
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== 'function') {
      return [message];
    }

    const args = JSON.parse(toolCall.function.arguments) as { steps?: unknown };
    if (!Array.isArray(args.steps) || args.steps.length === 0) {
      return [message];
    }

    const steps = args.steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0);
    return steps.length > 0 ? steps.slice(0, MAX_PLAN_STEPS) : [message];
  } catch {
    return [message];
  }
}
