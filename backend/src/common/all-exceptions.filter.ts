import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { env } from '../config/env.js';

interface HttpLikeResponse {
  status(code: number): HttpLikeResponse;
  json(body: unknown): unknown;
}

/**
 * Keeps the error response shape of the previous Express backend:
 *  - 404 -> { message: 'Route not found' }
 *  - 500 -> { message: 'Internal server error', detail? (development only) }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpLikeResponse>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (status === HttpStatus.NOT_FOUND && typeof body === 'object' && 'error' in body) {
        res.status(404).json({ message: 'Route not found' });
        return;
      }
      res.status(status).json(typeof body === 'string' ? { message: body } : body);
      return;
    }

    this.logger.error('Unhandled error', exception instanceof Error ? exception.stack : exception);
    const detail = exception instanceof Error ? exception.message : undefined;
    res.status(500).json({
      message: 'Internal server error',
      ...(env.nodeEnv === 'development' && detail ? { detail } : {}),
    });
  }
}
