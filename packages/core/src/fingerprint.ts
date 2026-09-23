import { createHash } from "node:crypto";

import { ContractGuardError } from "./errors.js";
import type { ContentFingerprint, OpenApiInput } from "./types.js";

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike | undefined };
const MAX_CANONICAL_DEPTH = 256;

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new WeakSet<object>(), 0);
}

function canonicalJsonValue(value: unknown, ancestors: WeakSet<object>, depth: number): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new ContractGuardError("INVALID_DOCUMENT", `Input nesting exceeds the supported depth of ${MAX_CANONICAL_DEPTH}.`);
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) {
    enterObject(value, ancestors);
    try {
      return `[${value.map((item) => canonicalJsonValue(item, ancestors, depth + 1)).join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "object") {
    enterObject(value, ancestors);
    const record = value as Record<string, JsonLike | undefined>;
    try {
      const entries = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key], ancestors, depth + 1)}`);
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  return JSON.stringify(String(value));
}

function enterObject(value: object, ancestors: WeakSet<object>): void {
  if (ancestors.has(value)) {
    throw new ContractGuardError("INVALID_DOCUMENT", "Input objects must not contain circular references.");
  }
  ancestors.add(value);
}

export function fingerprintText(value: string | Uint8Array): ContentFingerprint {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(value).digest("hex"),
  };
}

export function fingerprintOpenApiInput(input: OpenApiInput): ContentFingerprint {
  if (typeof input === "string" || input instanceof Uint8Array) return fingerprintText(input);
  return fingerprintText(canonicalJson(input));
}

export function fingerprintObject(value: unknown): ContentFingerprint {
  return fingerprintText(canonicalJson(value));
}
