export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown[] = [],
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;

    Object.setPrototypeOf(this, AppError.prototype);
  }
}
