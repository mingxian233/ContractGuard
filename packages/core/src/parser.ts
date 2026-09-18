import { parse as parseYaml } from "yaml";

import { ContractGuardError } from "./errors.js";
import type { OpenApiDocument, OpenApiInput, ParsedOpenApi } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateDocument(value: unknown): OpenApiDocument {
  if (!isRecord(value)) {
    throw new ContractGuardError(
      "INVALID_DOCUMENT",
      "OpenAPI document must be a JSON/YAML object.",
    );
  }

  if (value.swagger === "2.0") {
    throw new ContractGuardError(
      "UNSUPPORTED_SPEC_VERSION",
      "Swagger/OpenAPI 2.0 is not supported. Convert the document to OpenAPI 3.0 or 3.1 before analysis.",
      { detectedVersion: "2.0" },
    );
  }

  if (typeof value.openapi !== "string") {
    throw new ContractGuardError(
      "INVALID_DOCUMENT",
      'Missing required string field "openapi".',
    );
  }

  const [major, minor] = value.openapi.split(".").map(Number);
  if (major !== 3 || (minor !== 0 && minor !== 1)) {
    throw new ContractGuardError(
      "UNSUPPORTED_SPEC_VERSION",
      `OpenAPI ${value.openapi} is not supported. ContractGuard supports OpenAPI 3.0.x and 3.1.x.`,
      { detectedVersion: value.openapi, supportedVersions: ["3.0.x", "3.1.x"] },
    );
  }

  if (value.paths !== undefined && !isRecord(value.paths)) {
    throw new ContractGuardError(
      "INVALID_DOCUMENT",
      'Field "paths" must be an object when present.',
    );
  }

  return clone(value) as OpenApiDocument;
}

/** Parse and minimally validate an OpenAPI 3.0/3.1 JSON, YAML, or object input. */
export function parseOpenApi(input: OpenApiInput): ParsedOpenApi {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) {
    return { document: validateDocument(input), format: "object" };
  }

  const source = typeof input === "string" ? input : new TextDecoder().decode(input);
  if (source.trim() === "") {
    throw new ContractGuardError("PARSE_ERROR", "OpenAPI input is empty.");
  }

  let value: unknown;
  let format: "json" | "yaml" = "yaml";
  try {
    const trimmed = source.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      format = "json";
      value = JSON.parse(source) as unknown;
    } else {
      value = parseYaml(source, { prettyErrors: true, strict: true }) as unknown;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ContractGuardError(
      "PARSE_ERROR",
      `Could not parse OpenAPI ${format.toUpperCase()}: ${reason}`,
      { format },
    );
  }

  return { document: validateDocument(value), format };
}

/** Decode and resolve a local RFC 6901 JSON Pointer. External references are rejected. */
export function resolveLocalRef(document: OpenApiDocument, reference: string): unknown {
  if (!reference.startsWith("#")) {
    throw new ContractGuardError(
      "EXTERNAL_REFERENCE_UNSUPPORTED",
      `External reference "${reference}" is not supported; bundle it into the document first.`,
      { reference },
    );
  }
  if (reference === "#") return document;
  if (!reference.startsWith("#/")) {
    throw new ContractGuardError(
      "INVALID_REFERENCE",
      `Invalid local JSON Pointer "${reference}".`,
      { reference },
    );
  }

  let segments: string[];
  try {
    segments = reference
      .slice(2)
      .split("/")
      .map((segment) => decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ContractGuardError(
      "INVALID_REFERENCE",
      `Invalid percent-encoding in local JSON Pointer "${reference}": ${reason}`,
      { reference },
    );
  }

  let current: unknown = document;
  for (const segment of segments) {
    if (!isRecord(current) && !Array.isArray(current)) {
      throw new ContractGuardError(
        "INVALID_REFERENCE",
        `Reference "${reference}" does not resolve to a value.`,
        { reference, missingSegment: segment },
      );
    }
    if (!(segment in current)) {
      throw new ContractGuardError(
        "INVALID_REFERENCE",
        `Reference "${reference}" does not resolve to a value.`,
        { reference, missingSegment: segment },
      );
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Resolve a Reference Object while retaining legal sibling fields (OpenAPI 3.1). */
export function resolveNode(
  document: OpenApiDocument,
  value: unknown,
  visited = new Set<string>(),
): unknown {
  if (!isRecord(value) || typeof value.$ref !== "string") return value;
  if (visited.has(value.$ref)) return value;

  const nextVisited = new Set(visited);
  nextVisited.add(value.$ref);
  const target = resolveLocalRef(document, value.$ref);
  const resolved = resolveNode(document, target, nextVisited);
  if (!isRecord(resolved)) return resolved;

  const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
  return { ...resolved, ...siblings };
}
