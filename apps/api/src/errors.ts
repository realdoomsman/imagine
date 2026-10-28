/** A refusal with an HTTP status and a sentence the user can act on. */
export class ActionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
