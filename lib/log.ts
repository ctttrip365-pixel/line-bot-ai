// lib/log.ts — structured JSON logging for Vercel (searchable by field)

type LogLevel = 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

function logToConsole(level: LogLevel, event: string, ctx?: LogContext): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...ctx,
  });

  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export const log = {
  info: (event: string, ctx?: LogContext) => logToConsole('info', event, ctx),
  warn: (event: string, ctx?: LogContext) => logToConsole('warn', event, ctx),
  error: (event: string, ctx?: LogContext) => logToConsole('error', event, ctx),
};
