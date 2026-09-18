import { describe, expect, it } from "vitest";

import { analyzeCompatibility, ruleCatalog } from "../src/index.js";

type AnyDocument = Record<string, any>;

function document(operation: AnyDocument, extra: AnyDocument = {}): AnyDocument {
  return {
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0" },
    paths: { "/pets": { get: operation } },
    ...extra,
  };
}

function operation(extra: AnyDocument = {}): AnyDocument {
  return {
    operationId: "listPets",
    responses: {
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["items"],
              properties: {
                items: { type: "array", items: { type: "string", enum: ["cat", "dog"] } },
                cursor: { type: "string" },
              },
            },
          },
        },
      },
    },
    ...extra,
  };
}

function rules(result: ReturnType<typeof analyzeCompatibility>): string[] {
  return result.changes.map((item) => item.ruleId);
}

describe("analyzeCompatibility", () => {
  const fixedTime = "2026-01-02T03:04:05.000Z";

  it("returns a deterministic clean result for identical contracts", () => {
    const spec = document(operation());
    const result = analyzeCompatibility(spec, structuredClone(spec), { generatedAt: fixedTime });
    expect(result).toMatchObject({
      engineVersion: "1.0.0",
      generatedAt: fixedTime,
      score: 100,
      compatible: true,
      summary: { total: 0, breaking: 0, potentiallyBreaking: 0, nonBreaking: 0, info: 0 },
    });
    expect(result.source.old).toEqual({ openapi: "3.1.0", title: "Example API", version: "1.0.0" });
  });

  it("detects path and operation additions/removals", () => {
    const oldSpec = document(operation());
    const newSpec = document(operation(), {
      paths: { "/health": { get: operation({ operationId: "health" }) } },
    });
    const result = analyzeCompatibility(oldSpec, newSpec, { generatedAt: fixedTime });
    expect(result.compatible).toBe(false);
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "CG-0001", ruleId: "PATH_REMOVED", severity: "breaking" }),
      expect.objectContaining({ ruleId: "PATH_ADDED", severity: "non-breaking" }),
    ]));

    const oldWithPost = document(operation(), { paths: { "/pets": { get: operation(), post: operation() } } });
    const operationResult = analyzeCompatibility(oldWithPost, document(operation()), { generatedAt: fixedTime });
    expect(rules(operationResult)).toContain("OPERATION_REMOVED");
  });

  it("applies request direction to parameters, types, enums and constraints", () => {
    const oldSpec = document(operation({
      parameters: [
        { in: "query", name: "limit", schema: { type: "integer", minimum: 0 } },
        { in: "query", name: "mode", required: false, schema: { type: "string", enum: ["fast", "safe"] } },
      ],
    }));
    const newSpec = document(operation({
      parameters: [
        { in: "query", name: "limit", required: true, schema: { type: "number", minimum: 1 } },
        { in: "query", name: "mode", schema: { type: "string", enum: ["fast"] } },
        { in: "header", name: "X-Tenant", required: true, schema: { type: "string" } },
      ],
    }));
    const result = analyzeCompatibility(oldSpec, newSpec, { generatedAt: fixedTime });
    expect(result.compatible).toBe(false);
    expect(result.summary.breaking).toBeGreaterThanOrEqual(4);
    expect(rules(result)).toEqual(expect.arrayContaining([
      "PARAMETER_REQUIRED",
      "PARAMETER_ADDED_REQUIRED",
      "SCHEMA_TYPE_CHANGED",
      "SCHEMA_ENUM_NARROWED",
      "SCHEMA_CONSTRAINT_TIGHTENED",
    ]));
  });

  it("matches HTTP header parameters case-insensitively", () => {
    const withHeader = (name: string): AnyDocument => document(operation({
      parameters: [{ in: "header", name, required: true, schema: { type: "string" } }],
    }));
    const result = analyzeCompatibility(withHeader("X-Token"), withHeader("x-token"), { generatedAt: fixedTime });
    expect(result.changes).toHaveLength(0);
  });

  it("compares referenced request bodies and request media types", () => {
    const oldSpec = document(operation({
      requestBody: {
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/PetInput" } },
          "application/xml": { schema: { type: "string" } },
        },
      },
    }), {
      components: { schemas: { PetInput: { type: "object", properties: { name: { type: "string" } } } } },
    });
    const newSpec = document(operation({
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/PetInput" } } },
      },
    }), {
      components: { schemas: { PetInput: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } },
    });
    const result = analyzeCompatibility(oldSpec, newSpec, { generatedAt: fixedTime });
    expect(rules(result)).toEqual(expect.arrayContaining([
      "REQUEST_BODY_REQUIRED",
      "REQUEST_MEDIA_TYPE_REMOVED",
      "SCHEMA_REQUIRED_PROPERTY_ADDED",
    ]));
    expect(result.summary.breaking).toBe(3);
  });

  it("applies response direction to output properties, requiredness and enums", () => {
    const oldSpec = document(operation());
    const nextOperation = operation();
    const nextSchema = nextOperation.responses["200"].content["application/json"].schema;
    delete nextSchema.properties.cursor;
    nextSchema.required = [];
    nextSchema.properties.items.items.enum.push("bird");
    const result = analyzeCompatibility(oldSpec, document(nextOperation), { generatedAt: fixedTime });
    expect(rules(result)).toEqual(expect.arrayContaining([
      "SCHEMA_PROPERTY_REMOVED",
      "SCHEMA_REQUIRED_PROPERTY_REMOVED",
      "SCHEMA_ENUM_WIDENED",
    ]));
    expect(result.changes.find((item) => item.ruleId === "SCHEMA_ENUM_WIDENED")?.severity).toBe("potentially-breaking");
    expect(result.compatible).toBe(false);
  });

  it("detects response status/media removals and new success statuses", () => {
    const oldSpec = document(operation({
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: { type: "string" } }, "text/plain": { schema: { type: "string" } } } },
        "404": { description: "Missing" },
      },
    }));
    const newSpec = document(operation({
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: { type: "string" } } } },
        "201": { description: "Created" },
      },
    }));
    const result = analyzeCompatibility(oldSpec, newSpec, { generatedAt: fixedTime });
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "RESPONSE_MEDIA_TYPE_REMOVED", severity: "breaking" }),
      expect.objectContaining({ ruleId: "RESPONSE_STATUS_REMOVED", severity: "potentially-breaking" }),
      expect.objectContaining({ ruleId: "RESPONSE_STATUS_ADDED", severity: "potentially-breaking" }),
    ]));
  });

  it("detects strengthened and relaxed security including scopes", () => {
    const oldSpec = document(operation(), { security: [] });
    const secured = document(operation(), { security: [{ oauth: ["read:pets"] }] });
    const strengthened = analyzeCompatibility(oldSpec, secured, { generatedAt: fixedTime });
    expect(strengthened.changes).toContainEqual(expect.objectContaining({ ruleId: "SECURITY_STRENGTHENED", severity: "breaking" }));

    const relaxed = analyzeCompatibility(secured, oldSpec, { generatedAt: fixedTime });
    expect(relaxed.changes).toContainEqual(expect.objectContaining({ ruleId: "SECURITY_RELAXED", severity: "non-breaking" }));

    const moreScopes = document(operation(), { security: [{ oauth: ["read:pets", "admin"] }] });
    expect(rules(analyzeCompatibility(secured, moreScopes))).toContain("SECURITY_STRENGTHENED");
  });

  it("compares referenced security-scheme wire and discovery settings", () => {
    const secured = (scheme: AnyDocument): AnyDocument => document(operation(), {
      security: [{ auth: [] }],
      components: { securitySchemes: { auth: scheme } },
    });

    const apiKey = analyzeCompatibility(
      secured({ type: "apiKey", in: "header", name: "X-Old-Key" }),
      secured({ type: "apiKey", in: "query", name: "new_key" }),
      { generatedAt: fixedTime },
    );
    expect(apiKey.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "SECURITY_SCHEME_CHANGED", severity: "breaking", location: expect.stringContaining(".in") }),
      expect.objectContaining({ ruleId: "SECURITY_SCHEME_CHANGED", severity: "breaking", location: expect.stringContaining(".name") }),
    ]));

    const http = analyzeCompatibility(
      secured({ type: "http", scheme: "bearer", bearerFormat: "JWT" }),
      secured({ type: "http", scheme: "basic", bearerFormat: "opaque" }),
      { generatedAt: fixedTime },
    );
    expect(http.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "SECURITY_SCHEME_CHANGED", severity: "breaking", location: expect.stringContaining(".scheme") }),
      expect.objectContaining({ ruleId: "SECURITY_SCHEME_CHANGED", severity: "potentially-breaking", location: expect.stringContaining(".bearerFormat") }),
    ]));

    const openId = analyzeCompatibility(
      secured({ type: "openIdConnect", openIdConnectUrl: "https://old.example/.well-known/openid-configuration" }),
      secured({ type: "openIdConnect", openIdConnectUrl: "https://new.example/.well-known/openid-configuration" }),
      { generatedAt: fixedTime },
    );
    expect(openId.changes).toContainEqual(expect.objectContaining({
      ruleId: "SECURITY_SCHEME_CHANGED",
      severity: "potentially-breaking",
      location: expect.stringContaining(".openIdConnectUrl"),
    }));

    const oauth = analyzeCompatibility(
      secured({ type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://old.example/token", scopes: {} } } }),
      secured({ type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://new.example/token", scopes: {} } } }),
      { generatedAt: fixedTime },
    );
    expect(oauth.changes).toContainEqual(expect.objectContaining({
      ruleId: "SECURITY_SCHEME_CHANGED",
      severity: "potentially-breaking",
      location: expect.stringContaining(".flows"),
    }));

    const changedType = analyzeCompatibility(
      secured({ type: "apiKey", in: "header", name: "X-Key" }),
      secured({ type: "http", scheme: "bearer" }),
      { generatedAt: fixedTime },
    );
    expect(changedType.changes).toContainEqual(expect.objectContaining({
      ruleId: "SECURITY_SCHEME_CHANGED",
      severity: "breaking",
      location: expect.stringContaining(".type"),
    }));
  });

  it("honors readOnly and writeOnly when evaluating required properties", () => {
    const oldOperation = operation({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { serverId: { type: "string", readOnly: true } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["secret"],
                properties: { secret: { type: "string", writeOnly: true } },
              },
            },
          },
        },
      },
    });
    const newOperation = structuredClone(oldOperation);
    newOperation.requestBody.content["application/json"].schema.required = ["serverId"];
    newOperation.responses["200"].content["application/json"].schema.required = [];

    const result = analyzeCompatibility(document(oldOperation), document(newOperation), { generatedAt: fixedTime });
    expect(result.changes).toHaveLength(0);
  });

  it("detects required names even when properties does not declare them", () => {
    const requestWithSchema = (schema: AnyDocument): AnyDocument => document(operation({
      requestBody: { content: { "application/json": { schema } } },
    }));
    const result = analyzeCompatibility(
      requestWithSchema({ type: "object" }),
      requestWithSchema({ type: "object", required: ["tenantId"] }),
      { generatedAt: fixedTime },
    );
    expect(result.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_REQUIRED_PROPERTY_ADDED",
      severity: "breaking",
      location: expect.stringContaining("tenantId"),
    }));
  });

  it("models integer as a subset of number in both directions", () => {
    const requestSpec = (type: string): AnyDocument => document(operation({
      parameters: [{ name: "value", in: "query", schema: { type } }],
    }));
    const widenedInput = analyzeCompatibility(requestSpec("integer"), requestSpec("number"), { generatedAt: fixedTime });
    expect(widenedInput.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_TYPE_CHANGED",
      severity: "non-breaking",
    }));
    expect(widenedInput.compatible).toBe(true);

    const narrowedInput = analyzeCompatibility(requestSpec("number"), requestSpec("integer"), { generatedAt: fixedTime });
    expect(narrowedInput.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_TYPE_CHANGED",
      severity: "breaking",
    }));

    const responseSpec = (type: string): AnyDocument => document(operation({
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: { type } } } },
      },
    }));
    const narrowedOutput = analyzeCompatibility(responseSpec("number"), responseSpec("integer"), { generatedAt: fixedTime });
    expect(narrowedOutput.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_TYPE_CHANGED",
      severity: "non-breaking",
    }));
  });

  it("handles absent enums as unconstrained rather than as an empty enum", () => {
    const responseSpec = (schema: AnyDocument): AnyDocument => document(operation({
      responses: {
        "200": { description: "OK", content: { "application/json": { schema } } },
      },
    }));
    const narrowedOutput = analyzeCompatibility(
      responseSpec({ type: "string" }),
      responseSpec({ type: "string", enum: ["ready"] }),
      { generatedAt: fixedTime },
    );
    expect(narrowedOutput.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_ENUM_NARROWED",
      severity: "non-breaking",
    }));

    const requestSpec = (schema: AnyDocument): AnyDocument => document(operation({
      parameters: [{ name: "state", in: "query", schema }],
    }));
    const narrowedInput = analyzeCompatibility(
      requestSpec({ type: "string" }),
      requestSpec({ type: "string", enum: ["ready"] }),
      { generatedAt: fixedTime },
    );
    expect(narrowedInput.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_ENUM_NARROWED",
      severity: "breaking",
    }));
  });

  it("never silently ignores boolean, missing, or partially supported schemas", () => {
    const requestSchema = (schema: unknown, includeSchema = true): AnyDocument => document(operation({
      requestBody: {
        content: { "application/json": includeSchema ? { schema } : {} },
      },
    }));
    const booleanResult = analyzeCompatibility(requestSchema(true), requestSchema(false), { generatedAt: fixedTime });
    expect(booleanResult.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_BOOLEAN_CHANGED",
      severity: "breaking",
    }));

    const addedRequestSchema = analyzeCompatibility(
      requestSchema(undefined, false),
      requestSchema({ type: "string" }),
      { generatedAt: fixedTime },
    );
    expect(addedRequestSchema.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_PRESENCE_CHANGED",
      severity: "breaking",
    }));

    const constrainedArrayItems = analyzeCompatibility(
      requestSchema({ type: "array" }),
      requestSchema({ type: "array", items: { type: "string" } }),
      { generatedAt: fixedTime },
    );
    expect(constrainedArrayItems.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_PRESENCE_CHANGED",
      severity: "breaking",
      location: expect.stringContaining(".items"),
    }));

    const responseSchema = (schema: unknown, includeSchema = true): AnyDocument => document(operation({
      responses: {
        "200": { description: "OK", content: { "application/json": includeSchema ? { schema } : {} } },
      },
    }));
    const removedResponseSchema = analyzeCompatibility(
      responseSchema({ type: "string" }),
      responseSchema(undefined, false),
      { generatedAt: fixedTime },
    );
    expect(removedResponseSchema.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_PRESENCE_CHANGED",
      severity: "breaking",
    }));

    const constResult = analyzeCompatibility(
      responseSchema({ type: "string", const: "old" }),
      responseSchema({ type: "string", const: "new" }),
      { generatedAt: fixedTime },
    );
    expect(constResult.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_UNSUPPORTED_KEYWORD_CHANGED",
      severity: "potentially-breaking",
      location: expect.stringContaining(".const"),
    }));

    const constrainedUntypedInput = analyzeCompatibility(
      requestSchema({}),
      requestSchema({ type: "string" }),
      { generatedAt: fixedTime },
    );
    expect(constrainedUntypedInput.changes).toContainEqual(expect.objectContaining({
      ruleId: "SCHEMA_TYPE_CHANGED",
      severity: "breaking",
    }));
  });

  it("uses locale-independent ordering for stable change IDs", () => {
    const oldSpec = document(operation(), {
      paths: {
        "/ä": { get: operation({ operationId: "umlaut" }) },
        "/z": { get: operation({ operationId: "zed" }) },
      },
    });
    const newSpec = document(operation(), { paths: {} });
    const result = analyzeCompatibility(oldSpec, newSpec, { generatedAt: fixedTime });
    expect(result.changes.map((item) => item.location)).toEqual([
      'paths["/z"]',
      'paths["/ä"]',
    ]);
  });

  it("reports operationId, deprecation and human metadata separately", () => {
    const oldSpec = document(operation({ summary: "List pets" }));
    const newSpec = document(operation({ operationId: "findPets", deprecated: true, summary: "Find pets" }));
    const result = analyzeCompatibility(oldSpec, newSpec, { generatedAt: fixedTime });
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "OPERATION_ID_CHANGED", severity: "potentially-breaking" }),
      expect.objectContaining({ ruleId: "DEPRECATED_ADDED", severity: "info" }),
      expect.objectContaining({ ruleId: "METADATA_CHANGED", severity: "info" }),
    ]));
  });

  it("supports output filtering without changing compatibility semantics", () => {
    const oldSpec = document(operation());
    const newSpec = document(operation({ deprecated: true }), {
      paths: {
        "/pets": { get: operation({ deprecated: true }) },
        "/health": { get: operation({ operationId: "health" }) },
      },
    });
    const result = analyzeCompatibility(oldSpec, newSpec, {
      generatedAt: fixedTime,
      includeInfo: false,
      includeNonBreaking: false,
    });
    expect(result.changes).toHaveLength(0);
    expect(result.compatible).toBe(true);
  });

  it("terminates on recursive local-reference schemas", () => {
    const makeSpec = (required: string[] = []) => document(operation({
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } },
        },
      },
    }), {
      components: {
        schemas: {
          Node: {
            type: "object",
            required,
            properties: { value: { type: "string" }, child: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    });
    const result = analyzeCompatibility(makeSpec(["value"]), makeSpec([]), { generatedAt: fixedTime });
    expect(rules(result)).toContain("SCHEMA_REQUIRED_PROPERTY_REMOVED");
    expect(result.changes.length).toBeLessThan(10);
  });

  it("exposes a unique documented rule catalog", () => {
    expect(ruleCatalog.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ruleCatalog.map((rule) => rule.id)).size).toBe(ruleCatalog.length);
  });
});
