import type { JsonObject } from '../types/Json.js'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, context?: JsonObject): void
  info(message: string, context?: JsonObject): void
  warn(message: string, context?: JsonObject): void
  error(message: string, context?: JsonObject): void
  child(context: JsonObject): Logger
}

class ConsoleLogger implements Logger {
  constructor(private readonly baseContext: JsonObject = {}) {}

  debug(message: string, context: JsonObject = {}) {
    this.log('debug', message, context)
  }

  info(message: string, context: JsonObject = {}) {
    this.log('info', message, context)
  }

  warn(message: string, context: JsonObject = {}) {
    this.log('warn', message, context)
  }

  error(message: string, context: JsonObject = {}) {
    this.log('error', message, context)
  }

  child(context: JsonObject): Logger {
    return new ConsoleLogger({ ...this.baseContext, ...context })
  }

  private log(level: LogLevel, message: string, context: JsonObject) {
    process.stdout.write(
      JSON.stringify({
        level,
        message,
        ...this.baseContext,
        ...context,
      }) + '\n',
    )
  }
}

export function createLogger(baseContext: JsonObject = {}): Logger {
  return new ConsoleLogger(baseContext)
}