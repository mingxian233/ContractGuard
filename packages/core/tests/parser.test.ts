import { describe, expect, it } from "vitest";

import {
  ContractGuardError,
  parseOpenApi,
  resolveLocalRef,
  resolveNode,
} from "../src/index.js";

describe("parseOpenApi", () => {
  it("parses JSON, YAML, bytes and objects", () => {
    expect(parseOpenApi('{"openapi":"3.0.3","paths":{}}').format).toBe("json");
    expect(parseOpenApi("openapi: 3.1.0\npaths: {}\n").format).toBe("yaml");
    expect(parseOpenApi(new TextEncoder().encode("openapi: 3.0.0\npaths: {}\n")).format).toBe("yaml");
    expect(parseOpenApi({ openapi: "3.1.1", paths: {} }).format).toBe("object");
  });

  it("rejects Swagger 2.0 with an actionable typed error", () => {
    expect.assertions(3);
    try {
      parseOpenApi({ swagger: "2.0", paths: {} });
    } catch (error) {
      expect(error).toBeInstanceOf(ContractGuardError);
      expect((error as ContractGuardError).code).toBe("UNSUPPORTED_SPEC_VERSION");
      expect((error as Error).message).toContain("Convert");
    }
  });

  it.each(["3.2.0", "2.0.0", "4.0.0"])("rejects unsupported OpenAPI %s", (version) => {
    expect(() => parseOpenApi({ openapi: version, paths: {} })).toThrow(/supports OpenAPI 3\.0\.x and 3\.1\.x/);
  });

  it("reports parse errors and invalid document shape", () => {
    expect(() => parseOpenApi("openapi: [")).toThrowError(ContractGuardError);
    expect(() => parseOpenApi("")).toThrow(/empty/);
    expect(() => parseOpenApi({ openapi: "3.0.3", paths: [] })).toThrow(/paths/);
  });
});

describe("local references", () => {
  const document = parseOpenApi({
    openapi: "3.1.0",
    paths: {},
    components: {
      schemas: {
        "Pet/name": { type: "string" },
        Pet: { $ref: "#/components/schemas/Pet~1name", description: "sibling override" },
      },
    },
  }).document;

  it("resolves RFC 6901 escaped JSON pointers", () => {
    expect(resolveLocalRef(document, "#/components/schemas/Pet~1name")).toEqual({ type: "string" });
  });

  it("resolves reference chains and retains OpenAPI 3.1 siblings", () => {
    expect(resolveNode(document, { $ref: "#/components/schemas/Pet" })).toEqual({
      type: "string",
      description: "sibling override",
    });
  });

  it("rejects invalid and external references clearly", () => {
    expect(() => resolveLocalRef(document, "other.yaml#/Pet")).toThrow(/External reference/);
    expect(() => resolveLocalRef(document, "#/components/schemas/Missing")).toThrow(/does not resolve/);
    expect(() => resolveLocalRef(document, "#bad")).toThrow(/Invalid local JSON Pointer/);
  });

  it("wraps malformed percent-encoding as a typed invalid-reference error", () => {
    expect.assertions(2);
    try {
      resolveLocalRef(document, "#/components/schemas/%ZZ");
    } catch (error) {
      expect(error).toBeInstanceOf(ContractGuardError);
      expect((error as ContractGuardError).code).toBe("INVALID_REFERENCE");
    }
  });
});
