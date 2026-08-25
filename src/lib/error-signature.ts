import type { ParsedSentryError } from "./sentry";

/** Same project + exception type + message = the same underlying error, just fired again. */
export function errorSignature(projectName: string | undefined, error: ParsedSentryError): string {
  return `${projectName ?? "?"}::${error.exceptionType ?? ""}::${error.message}`;
}
