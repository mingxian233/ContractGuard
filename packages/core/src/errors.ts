export type ContractGuardErrorCode =
  | "PARSE_ERROR"
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_SPEC_VERSION"
  | "INVALID_REFERENCE"
  | "EXTERNAL_REFERENCE_UNSUPPORTED";

export class ContractGuardError extends Error {
  readonly code: ContractGuardErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ContractGuardErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContractGuardError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
