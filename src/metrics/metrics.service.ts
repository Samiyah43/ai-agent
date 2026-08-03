import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// One Registry per process, shared by every metric below and scraped by the
// /metrics endpoint. collectDefaultMetrics adds Node.js runtime metrics
// (CPU, memory, event loop lag) for free, on top of the app-specific ones.
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled, by method/route/status',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method/route',
    labelNames: ['method', 'route'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly toolCallsTotal = new Counter({
    name: 'agent_tool_calls_total',
    help: 'Total agent tool calls, by tool name and outcome (ok/error)',
    labelNames: ['tool', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly chatErrorsTotal = new Counter({
    name: 'agent_chat_errors_total',
    help: 'Total /chat requests that failed because the upstream LLM call errored',
    registers: [this.registry],
  });

  readonly agentRequestsTotal = new Counter({
    name: 'agent_requests_total',
    help: 'Total /chat requests routed to each specialist agent, by agent name',
    labelNames: ['agent'] as const,
    registers: [this.registry],
  });

  readonly taskPlansTotal = new Counter({
    name: 'agent_task_plans_total',
    help: 'Total /chat requests that were broken down into a multi-step task plan',
    registers: [this.registry],
  });

  readonly taskPlanSteps = new Histogram({
    name: 'agent_task_plan_steps',
    help: 'Number of steps per executed task plan',
    buckets: [1, 2, 3, 4, 5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
