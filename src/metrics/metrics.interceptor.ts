import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

// Wraps every HTTP request to record it in Prometheus metrics. Runs for both
// successful and failed requests — the error case reads the status off the
// thrown exception, since AllExceptionsFilter sets response.statusCode
// *after* this interceptor's error callback runs.
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const route = request.route?.path ?? request.path;
    const startedAt = process.hrtime.bigint();

    const record = (status: number) => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.httpRequestDurationSeconds.observe({ method: request.method, route }, seconds);
      this.metrics.httpRequestsTotal.inc({ method: request.method, route, status: String(status) });
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        error: (error: { status?: number; getStatus?: () => number }) =>
          record(error.getStatus?.() ?? error.status ?? 500),
      }),
    );
  }
}
