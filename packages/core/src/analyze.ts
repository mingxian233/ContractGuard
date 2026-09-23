import type {
  AnalysisResult,
  AnalyzeOptions,
  Change,
  ChangeCategory,
  OpenApiDocument,
  OpenApiInput,
  Severity,
} from "./types.js";
import { fingerprintOpenApiInput } from "./fingerprint.js";
import { parseOpenApi, resolveNode } from "./parser.js";
import { resolveRulePolicy, type ResolvedRulePolicy } from "./policy.js";

export const ENGINE_VERSION = "1.1.0";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
type Direction = "request" | "response";
type Node = Record<string, unknown>;
type DraftChange = Omit<Change, "id">;

interface CompareContext {
  oldDocument: OpenApiDocument;
  newDocument: OpenApiDocument;
  changes: DraftChange[];
  comparedSecuritySchemes: Set<string>;
  options: Required<Pick<AnalyzeOptions, "includeInfo" | "includeNonBreaking">>;
  policy: ResolvedRulePolicy;
}

function isRecord(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(document: OpenApiDocument, value: unknown): Node | undefined {
  const resolved = resolveNode(document, value);
  return isRecord(resolved) ? resolved : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function own(record: Node | undefined, key: string): boolean {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function equal(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

/** Locale-independent UTF-16 code-unit ordering for reproducible IDs across hosts. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function add(ctx: CompareContext, change: DraftChange): void {
  const configured = ctx.policy.rules[change.ruleId];
  if (configured?.enabled === false) return;
  const resolved = configured?.severity === undefined ? change : { ...change, severity: configured.severity };
  if (resolved.severity === "info" && !ctx.options.includeInfo) return;
  if (resolved.severity === "non-breaking" && !ctx.options.includeNonBreaking) return;
  ctx.changes.push(resolved);
}

function change(
  ruleId: string,
  severity: Severity,
  category: ChangeCategory,
  location: string,
  message: string,
  details: Pick<DraftChange, "before" | "after" | "recommendation"> = {},
): DraftChange {
  return { ruleId, severity, category, location, message, ...details };
}

function operationLocation(path: string, method: string): string {
  return `paths[${JSON.stringify(path)}].${method}`;
}

function schemaTypeSet(schema: Node): Set<string> {
  const types = new Set<string>();
  if (typeof schema.type === "string") types.add(schema.type);
  if (Array.isArray(schema.type)) {
    for (const type of schema.type) if (typeof type === "string") types.add(type);
  }
  if (schema.nullable === true) types.add("null");
  if (types.size === 0) {
    if (isRecord(schema.properties) || Array.isArray(schema.required)) types.add("object");
    else if (schema.items !== undefined) types.add("array");
  }
  return types;
}

function isSubset<T>(left: Set<T>, right: Set<T>): boolean {
  for (const item of left) if (!right.has(item)) return false;
  return true;
}

/** JSON Schema integers are a subset of numbers; an empty set means no type constraint. */
function isTypeSubset(left: Set<string>, right: Set<string>): boolean {
  if (right.size === 0) return true;
  if (left.size === 0) return false;
  for (const type of left) {
    if (right.has(type)) continue;
    if (type === "integer" && right.has("number")) continue;
    return false;
  }
  return true;
}

function enumMap(value: unknown): Map<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;
  return new Map(value.map((item) => [stable(item), item]));
}

function schemaRef(value: unknown): string | undefined {
  return isRecord(value) && typeof value.$ref === "string" ? value.$ref : undefined;
}

function compareTypes(
  ctx: CompareContext,
  oldSchema: Node,
  newSchema: Node,
  direction: Direction,
  location: string,
): void {
  const oldTypes = schemaTypeSet(oldSchema);
  const newTypes = schemaTypeSet(newSchema);
  if (equal([...oldTypes].sort(), [...newTypes].sort())) return;

  const compatible = direction === "request"
    ? isTypeSubset(oldTypes, newTypes)
    : isTypeSubset(newTypes, oldTypes);
  add(ctx, change(
    "SCHEMA_TYPE_CHANGED",
    compatible ? "non-breaking" : "breaking",
    "schema",
    `${location}.type`,
    compatible
      ? `${direction === "request" ? "Accepted input" : "Produced output"} types became no less compatible.`
      : `${direction === "request" ? "Accepted input" : "Produced output"} types changed incompatibly.`,
    {
      before: [...oldTypes].sort(),
      after: [...newTypes].sort(),
      recommendation: compatible ? undefined : "Keep the old type in a transition release or introduce a new field/version.",
    },
  ));
}

function compareEnums(
  ctx: CompareContext,
  oldSchema: Node,
  newSchema: Node,
  direction: Direction,
  location: string,
): void {
  const oldEnum = enumMap(oldSchema.enum);
  const newEnum = enumMap(newSchema.enum);
  if (oldEnum === undefined && newEnum === undefined) return;
  if (oldEnum !== undefined && newEnum !== undefined && equal([...oldEnum.keys()].sort(), [...newEnum.keys()].sort())) return;

  const oldKeys = new Set(oldEnum?.keys() ?? []);
  const newKeys = new Set(newEnum?.keys() ?? []);
  const removed = oldEnum === undefined ? [] : [...oldKeys].filter((key) => !newKeys.has(key));
  const added = newEnum === undefined ? [] : [...newKeys].filter((key) => !oldKeys.has(key));
  const before = oldEnum === undefined ? undefined : [...oldEnum.values()];
  const after = newEnum === undefined ? undefined : [...newEnum.values()];

  if (direction === "request") {
    if (newEnum !== undefined && (oldEnum === undefined || removed.length > 0)) {
      add(ctx, change("SCHEMA_ENUM_NARROWED", "breaking", "schema", `${location}.enum`, "The request enum accepts fewer values.", {
        before,
        after,
        recommendation: "Continue accepting every previously documented enum value during migration.",
      }));
    } else if (newEnum === undefined || added.length > 0) {
      add(ctx, change("SCHEMA_ENUM_WIDENED", "non-breaking", "schema", `${location}.enum`, "The request enum accepts additional values.", { before, after }));
    }
  } else {
    if (oldEnum === undefined && newEnum !== undefined) {
      add(ctx, change("SCHEMA_ENUM_NARROWED", "non-breaking", "schema", `${location}.enum`, "The response enum now produces a narrower set of values.", { before, after }));
    } else if (newEnum === undefined || added.length > 0) {
      add(ctx, change("SCHEMA_ENUM_WIDENED", "potentially-breaking", "schema", `${location}.enum`, "The response may now contain values that existing exhaustive clients do not handle.", {
        before,
        after,
        recommendation: "Version the enum or verify that consumers tolerate unknown values.",
      }));
    } else if (oldEnum === undefined || removed.length > 0) {
      add(ctx, change("SCHEMA_ENUM_NARROWED", "non-breaking", "schema", `${location}.enum`, "The response enum now produces a narrower set of values.", { before, after }));
    }
  }
}

const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "const",
  "format",
  "multipleOf",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  "prefixItems",
  "not",
  "if",
  "then",
  "else",
  "dependentRequired",
  "dependentSchemas",
  "patternProperties",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "$dynamicRef",
  "$recursiveRef",
  "discriminator",
] as const;

function compareUnsupportedSchemaKeywords(
  ctx: CompareContext,
  oldSchema: Node,
  newSchema: Node,
  location: string,
): void {
  for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) {
    if (equal(oldSchema[keyword], newSchema[keyword])) continue;
    add(ctx, change(
      "SCHEMA_UNSUPPORTED_KEYWORD_CHANGED",
      "potentially-breaking",
      "schema",
      `${location}.${keyword}`,
      `Schema keyword ${keyword} changed; ContractGuard cannot prove the change is backward-compatible.`,
      {
        before: oldSchema[keyword],
        after: newSchema[keyword],
        recommendation: "Review this keyword manually and add consumer contract tests before release.",
      },
    ));
  }

  const oldAdditional = oldSchema.additionalProperties;
  const newAdditional = newSchema.additionalProperties;
  const schemaValuedAdditional = isRecord(oldAdditional) || isRecord(newAdditional);
  if (schemaValuedAdditional
    && oldAdditional !== false
    && newAdditional !== false
    && !equal(oldAdditional, newAdditional)) {
    add(ctx, change(
      "SCHEMA_UNSUPPORTED_KEYWORD_CHANGED",
      "potentially-breaking",
      "schema",
      `${location}.additionalProperties`,
      "Schema-valued additionalProperties changed; value-schema containment could not be proven.",
      {
        before: oldAdditional,
        after: newAdditional,
        recommendation: "Verify that every previously valid additional property remains accepted and every new response value remains valid for old clients.",
      },
    ));
  }
}

const LOWER_BOUNDS = ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"] as const;
const UPPER_BOUNDS = ["maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"] as const;

function compareBound(
  ctx: CompareContext,
  oldSchema: Node,
  newSchema: Node,
  direction: Direction,
  location: string,
  key: string,
  lower: boolean,
): void {
  const before = oldSchema[key];
  const after = newSchema[key];
  if (equal(before, after)) return;
  const beforeNumber = typeof before === "number" ? before : undefined;
  const afterNumber = typeof after === "number" ? after : undefined;
  let inputTightened = false;
  if (beforeNumber === undefined && afterNumber !== undefined) inputTightened = true;
  else if (beforeNumber !== undefined && afterNumber === undefined) inputTightened = false;
  else if (beforeNumber !== undefined && afterNumber !== undefined) inputTightened = lower ? afterNumber > beforeNumber : afterNumber < beforeNumber;
  else return;

  const incompatible = direction === "request" ? inputTightened : !inputTightened;
  add(ctx, change(
    incompatible ? "SCHEMA_CONSTRAINT_TIGHTENED" : "SCHEMA_CONSTRAINT_RELAXED",
    incompatible ? (direction === "request" ? "breaking" : "potentially-breaking") : "non-breaking",
    "schema",
    `${location}.${key}`,
    incompatible
      ? `${key} changed in a way that ${direction === "request" ? "rejects previously valid input" : "permits output outside the old contract"}.`
      : `${key} changed without reducing backward compatibility.`,
    { before, after, recommendation: incompatible ? "Retain the old constraint or introduce the constraint in a new API version." : undefined },
  ));
}

function compareConstraints(
  ctx: CompareContext,
  oldSchema: Node,
  newSchema: Node,
  direction: Direction,
  location: string,
): void {
  for (const key of LOWER_BOUNDS) compareBound(ctx, oldSchema, newSchema, direction, location, key, true);
  for (const key of UPPER_BOUNDS) compareBound(ctx, oldSchema, newSchema, direction, location, key, false);

  if (!equal(oldSchema.pattern, newSchema.pattern)) {
    const added = oldSchema.pattern === undefined && typeof newSchema.pattern === "string";
    const removed = typeof oldSchema.pattern === "string" && newSchema.pattern === undefined;
    const incompatible = direction === "request" ? !removed : !added;
    add(ctx, change(
      incompatible ? "SCHEMA_CONSTRAINT_TIGHTENED" : "SCHEMA_CONSTRAINT_RELAXED",
      incompatible ? "potentially-breaking" : "non-breaking",
      "schema",
      `${location}.pattern`,
      incompatible ? `Pattern changed and may make ${direction}s incompatible.` : "Pattern constraint was relaxed compatibly.",
      { before: oldSchema.pattern, after: newSchema.pattern, recommendation: incompatible ? "Test representative payloads against both patterns before release." : undefined },
    ));
  }

  const oldAdditional = oldSchema.additionalProperties !== false;
  const newAdditional = newSchema.additionalProperties !== false;
  if (oldAdditional !== newAdditional) {
    const inputTightened = oldAdditional && !newAdditional;
    const incompatible = direction === "request" ? inputTightened : !inputTightened;
    add(ctx, change(
      incompatible ? "SCHEMA_CONSTRAINT_TIGHTENED" : "SCHEMA_CONSTRAINT_RELAXED",
      incompatible ? "breaking" : "non-breaking",
      "schema",
      `${location}.additionalProperties`,
      incompatible
        ? `${direction === "request" ? "Previously accepted input" : "New output"} may violate the additional-properties policy.`
        : "The additional-properties policy changed compatibly.",
      { before: oldSchema.additionalProperties, after: newSchema.additionalProperties },
    ));
  }
}

function requiredSet(schema: Node): Set<string> {
  return new Set(asArray(schema.required).filter((item): item is string => typeof item === "string"));
}

function properties(document: OpenApiDocument, schema: Node): Record<string, unknown> {
  const resolved = asRecord(document, schema.properties);
  return resolved ?? {};
}

function propertyApplies(
  document: OpenApiDocument,
  value: unknown,
  direction: Direction,
): boolean {
  const schema = asRecord(document, value);
  if (schema === undefined) return true;
  return direction === "request" ? schema.readOnly !== true : schema.writeOnly !== true;
}

function compareObjectSchema(
  ctx: CompareContext,
  oldSchema: Node,
  newSchema: Node,
  direction: Direction,
  location: string,
  visited: Set<string>,
): void {
  const oldRequired = requiredSet(oldSchema);
  const newRequired = requiredSet(newSchema);
  const oldProperties = properties(ctx.oldDocument, oldSchema);
  const newProperties = properties(ctx.newDocument, newSchema);

  const propertyNames = new Set([
    ...Object.keys(oldProperties),
    ...Object.keys(newProperties),
    ...oldRequired,
    ...newRequired,
  ]);
  for (const name of [...propertyNames].sort()) {
    const childLocation = `${location}.properties[${JSON.stringify(name)}]`;
    const inOld = own(oldProperties, name)
      && propertyApplies(ctx.oldDocument, oldProperties[name], direction);
    const inNew = own(newProperties, name)
      && propertyApplies(ctx.newDocument, newProperties[name], direction);
    if (!inOld && !inNew) {
      const oldRequirementApplies = oldRequired.has(name)
        && (!own(oldProperties, name) || propertyApplies(ctx.oldDocument, oldProperties[name], direction));
      const newRequirementApplies = newRequired.has(name)
        && (!own(newProperties, name) || propertyApplies(ctx.newDocument, newProperties[name], direction));
      if (oldRequirementApplies !== newRequirementApplies) {
        const incompatible = direction === "request" ? newRequirementApplies : !newRequirementApplies;
        add(ctx, change(
          newRequirementApplies ? "SCHEMA_REQUIRED_PROPERTY_ADDED" : "SCHEMA_REQUIRED_PROPERTY_REMOVED",
          incompatible ? "breaking" : "non-breaking",
          "schema",
          `${childLocation}.required`,
          incompatible
            ? `${direction === "request" ? "Request" : "Response"} property ${JSON.stringify(name)} changed requiredness incompatibly.`
            : `Property ${JSON.stringify(name)} changed requiredness compatibly.`,
          {
            before: oldRequirementApplies,
            after: newRequirementApplies,
            recommendation: incompatible ? "Preserve the former requiredness for existing API consumers." : undefined,
          },
        ));
      }
      continue;
    }
    if (inOld && !inNew) {
      add(ctx, change("SCHEMA_PROPERTY_REMOVED", "breaking", "schema", childLocation,
        direction === "request" ? "A previously documented request property was removed." : "A response property used by clients was removed.",
        { before: oldProperties[name], recommendation: "Retain the property through a deprecation window or release a new API version." }));
      continue;
    }
    if (!inOld && inNew) {
      if (newRequired.has(name)) {
        const incompatible = direction === "request";
        add(ctx, change("SCHEMA_REQUIRED_PROPERTY_ADDED", incompatible ? "breaking" : "non-breaking", "schema", childLocation,
          incompatible ? "A required request property was added." : "A new response property is guaranteed to be present.",
          { after: newProperties[name], recommendation: incompatible ? "Make the new property optional or version the operation." : undefined }));
      } else {
        add(ctx, change("SCHEMA_PROPERTY_ADDED", "non-breaking", "schema", childLocation,
          direction === "request" ? "An optional request property was added." : "An optional response property was added.",
          { after: newProperties[name] }));
      }
      continue;
    }

    const wasRequired = oldRequired.has(name);
    const nowRequired = newRequired.has(name);
    if (wasRequired !== nowRequired) {
      const incompatible = direction === "request" ? nowRequired : !nowRequired;
      add(ctx, change(
        nowRequired ? "SCHEMA_REQUIRED_PROPERTY_ADDED" : "SCHEMA_REQUIRED_PROPERTY_REMOVED",
        incompatible ? "breaking" : "non-breaking",
        "schema",
        `${childLocation}.required`,
        incompatible
          ? `${direction === "request" ? "Request" : "Response"} property ${JSON.stringify(name)} changed requiredness incompatibly.`
          : `Property ${JSON.stringify(name)} changed requiredness compatibly.`,
        { before: wasRequired, after: nowRequired, recommendation: incompatible ? "Preserve the former requiredness for existing API consumers." : undefined },
      ));
    }
    compareSchema(ctx, oldProperties[name], newProperties[name], direction, childLocation, visited);
  }
}

function compareBooleanSchema(
  ctx: CompareContext,
  oldValue: unknown,
  newValue: unknown,
  direction: Direction,
  location: string,
): boolean {
  const resolvedOld = resolveNode(ctx.oldDocument, oldValue);
  const resolvedNew = resolveNode(ctx.newDocument, newValue);
  const oldBoolean = typeof resolvedOld === "boolean";
  const newBoolean = typeof resolvedNew === "boolean";
  if (!oldBoolean && !newBoolean) return false;
  if (oldBoolean && newBoolean && resolvedOld === resolvedNew) return true;

  // false is the empty instance set, true is the universal instance set, and
  // every ordinary Schema Object lies between them.
  const compatible = direction === "request"
    ? resolvedOld === false || resolvedNew === true
    : resolvedNew === false || resolvedOld === true;
  add(ctx, change(
    "SCHEMA_BOOLEAN_CHANGED",
    compatible ? "non-breaking" : "breaking",
    "schema",
    location,
    compatible
      ? `The boolean Schema change does not reduce ${direction} backward compatibility.`
      : `The boolean Schema change makes ${direction}s incompatible.`,
    {
      before: oldBoolean ? resolvedOld : "<schema-object>",
      after: newBoolean ? resolvedNew : "<schema-object>",
      recommendation: compatible ? undefined : "Retain the previous accepted/produced instance set or version the operation.",
    },
  ));
  return true;
}

function compareSchema(
  ctx: CompareContext,
  oldValue: unknown,
  newValue: unknown,
  direction: Direction,
  location: string,
  visited = new Set<string>(),
): void {
  if (oldValue === undefined && newValue === undefined) return;
  if (oldValue === undefined || newValue === undefined) {
    const compatible = direction === "request"
      ? newValue === undefined
      : oldValue === undefined;
    add(ctx, change(
      "SCHEMA_PRESENCE_CHANGED",
      compatible ? "non-breaking" : "breaking",
      "schema",
      location,
      compatible
        ? `The ${direction} schema presence changed without reducing backward compatibility.`
        : `Adding or removing the ${direction} schema changes the documented instance set in an incompatible direction.`,
      {
        before: oldValue === undefined ? "<unspecified>" : oldValue,
        after: newValue === undefined ? "<unspecified>" : newValue,
        recommendation: compatible ? undefined : "Keep the former schema contract or introduce the change in a versioned operation.",
      },
    ));
    return;
  }
  if (compareBooleanSchema(ctx, oldValue, newValue, direction, location)) return;
  const oldReference = schemaRef(oldValue);
  const newReference = schemaRef(newValue);
  const pair = `${direction}:${oldReference ?? "inline"}->${newReference ?? "inline"}`;
  if ((oldReference !== undefined || newReference !== undefined) && visited.has(pair)) return;
  const nextVisited = new Set(visited);
  if (oldReference !== undefined || newReference !== undefined) nextVisited.add(pair);

  const oldSchema = asRecord(ctx.oldDocument, oldValue);
  const newSchema = asRecord(ctx.newDocument, newValue);
  if (oldSchema === undefined || newSchema === undefined) return;

  compareTypes(ctx, oldSchema, newSchema, direction, location);
  compareEnums(ctx, oldSchema, newSchema, direction, location);
  compareConstraints(ctx, oldSchema, newSchema, direction, location);
  compareUnsupportedSchemaKeywords(ctx, oldSchema, newSchema, location);
  compareObjectSchema(ctx, oldSchema, newSchema, direction, location, nextVisited);

  compareSchema(ctx, oldSchema.items, newSchema.items, direction, `${location}.items`, nextVisited);

  for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
    if (own(oldSchema, keyword) || own(newSchema, keyword)) {
      const oldItems = asArray(oldSchema[keyword]);
      const newItems = asArray(newSchema[keyword]);
      const oldItemSet = oldItems.map((item) => stable(resolveNode(ctx.oldDocument, item))).sort();
      const newItemSet = newItems.map((item) => stable(resolveNode(ctx.newDocument, item))).sort();
      if (equal(oldItemSet, newItemSet)) continue;
      if (oldItems.length !== newItems.length) {
        const inputTightened = keyword === "allOf" ? newItems.length > oldItems.length : newItems.length < oldItems.length;
        const incompatible = direction === "request" ? inputTightened : !inputTightened;
        add(ctx, change(
          incompatible ? "SCHEMA_CONSTRAINT_TIGHTENED" : "SCHEMA_CONSTRAINT_RELAXED",
          incompatible ? "potentially-breaking" : "non-breaking",
          "schema",
          `${location}.${keyword}`,
          `${keyword} branch count changed from ${oldItems.length} to ${newItems.length}.`,
          { before: oldItems.length, after: newItems.length, recommendation: incompatible ? "Review composed-schema variants and test real consumer payloads." : undefined },
        ));
      }
      for (let index = 0; index < Math.min(oldItems.length, newItems.length); index += 1) {
        compareSchema(ctx, oldItems[index], newItems[index], direction, `${location}.${keyword}[${index}]`, nextVisited);
      }
    }
  }
}

interface ParameterEntry {
  parameter: Node;
  key: string;
  name: string;
  in: string;
}

function collectParameters(document: OpenApiDocument, pathItem: Node, operation: Node): Map<string, ParameterEntry> {
  const result = new Map<string, ParameterEntry>();
  for (const raw of [...asArray(pathItem.parameters), ...asArray(operation.parameters)]) {
    const parameter = asRecord(document, raw);
    if (parameter === undefined || typeof parameter.name !== "string" || typeof parameter.in !== "string") continue;
    const comparisonName = parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name;
    const key = `${parameter.in}:${comparisonName}`;
    result.set(key, { parameter, key, name: parameter.name, in: parameter.in });
  }
  return result;
}

function parameterSchema(parameter: Node): unknown {
  if (parameter.schema !== undefined) return parameter.schema;
  const content = isRecord(parameter.content) ? parameter.content : undefined;
  if (content === undefined) return undefined;
  const mediaType = Object.keys(content).sort()[0];
  if (mediaType === undefined) return undefined;
  const media = content[mediaType];
  return isRecord(media) ? media.schema : undefined;
}

function compareParameters(
  ctx: CompareContext,
  oldPathItem: Node,
  newPathItem: Node,
  oldOperation: Node,
  newOperation: Node,
  base: string,
): void {
  const oldParameters = collectParameters(ctx.oldDocument, oldPathItem, oldOperation);
  const newParameters = collectParameters(ctx.newDocument, newPathItem, newOperation);
  for (const key of [...new Set([...oldParameters.keys(), ...newParameters.keys()])].sort()) {
    const oldEntry = oldParameters.get(key);
    const newEntry = newParameters.get(key);
    const entry = oldEntry ?? newEntry;
    if (entry === undefined) continue;
    const location = `${base}.parameters.${entry.in}[${JSON.stringify(entry.name)}]`;
    if (oldEntry !== undefined && newEntry === undefined) {
      add(ctx, change("PARAMETER_REMOVED", "potentially-breaking", "parameter", location, `Request parameter ${entry.in}:${entry.name} was removed.`, {
        before: oldEntry.parameter,
        recommendation: "Continue accepting the parameter during a deprecation window, even if it is ignored.",
      }));
      continue;
    }
    if (oldEntry === undefined && newEntry !== undefined) {
      const required = newEntry.parameter.required === true || newEntry.in === "path";
      add(ctx, change(
        required ? "PARAMETER_ADDED_REQUIRED" : "PARAMETER_ADDED_OPTIONAL",
        required ? "breaking" : "non-breaking",
        "parameter",
        location,
        `${required ? "Required" : "Optional"} request parameter ${entry.in}:${entry.name} was added.`,
        { after: newEntry.parameter, recommendation: required ? "Make the new parameter optional or introduce it in a new operation/version." : undefined },
      ));
      continue;
    }
    if (oldEntry === undefined || newEntry === undefined) continue;
    const oldRequired = oldEntry.parameter.required === true || oldEntry.in === "path";
    const newRequired = newEntry.parameter.required === true || newEntry.in === "path";
    if (oldRequired !== newRequired) {
      add(ctx, change(
        newRequired ? "PARAMETER_REQUIRED" : "PARAMETER_OPTIONAL",
        newRequired ? "breaking" : "non-breaking",
        "parameter",
        `${location}.required`,
        `Parameter ${entry.in}:${entry.name} became ${newRequired ? "required" : "optional"}.`,
        { before: oldRequired, after: newRequired, recommendation: newRequired ? "Keep the parameter optional for existing callers." : undefined },
      ));
    }
    compareSchema(ctx, parameterSchema(oldEntry.parameter), parameterSchema(newEntry.parameter), "request", `${location}.schema`);
  }
}

function bodyNode(document: OpenApiDocument, operation: Node): Node | undefined {
  return operation.requestBody === undefined ? undefined : asRecord(document, operation.requestBody);
}

function contentNode(document: OpenApiDocument, owner: Node | undefined): Node {
  return owner === undefined ? {} : (asRecord(document, owner.content) ?? {});
}

function compareRequestBody(ctx: CompareContext, oldOperation: Node, newOperation: Node, base: string): void {
  const oldBody = bodyNode(ctx.oldDocument, oldOperation);
  const newBody = bodyNode(ctx.newDocument, newOperation);
  const location = `${base}.requestBody`;
  if (oldBody !== undefined && newBody === undefined) {
    add(ctx, change("REQUEST_BODY_REMOVED", "potentially-breaking", "request-body", location, "The accepted request body was removed.", {
      before: oldBody,
      recommendation: "Continue accepting the old body shape during migration.",
    }));
    return;
  }
  if (oldBody === undefined && newBody !== undefined) {
    const required = newBody.required === true;
    add(ctx, change(
      required ? "REQUEST_BODY_ADDED_REQUIRED" : "REQUEST_BODY_ADDED_OPTIONAL",
      required ? "breaking" : "non-breaking",
      "request-body",
      location,
      `A ${required ? "required" : "optional"} request body was added.`,
      { after: newBody, recommendation: required ? "Make the body optional for existing callers or version the operation." : undefined },
    ));
    return;
  }
  if (oldBody === undefined || newBody === undefined) return;
  const oldRequired = oldBody.required === true;
  const newRequired = newBody.required === true;
  if (oldRequired !== newRequired) {
    add(ctx, change(
      newRequired ? "REQUEST_BODY_REQUIRED" : "REQUEST_BODY_OPTIONAL",
      newRequired ? "breaking" : "non-breaking",
      "request-body",
      `${location}.required`,
      `The request body became ${newRequired ? "required" : "optional"}.`,
      { before: oldRequired, after: newRequired, recommendation: newRequired ? "Keep the body optional for existing callers." : undefined },
    ));
  }
  const oldContent = contentNode(ctx.oldDocument, oldBody);
  const newContent = contentNode(ctx.newDocument, newBody);
  for (const mediaType of [...new Set([...Object.keys(oldContent), ...Object.keys(newContent)])].sort()) {
    const mediaLocation = `${location}.content[${JSON.stringify(mediaType)}]`;
    if (own(oldContent, mediaType) && !own(newContent, mediaType)) {
      add(ctx, change("REQUEST_MEDIA_TYPE_REMOVED", "breaking", "request-body", mediaLocation, `Request media type ${mediaType} is no longer accepted.`, {
        recommendation: "Retain the old media type until clients migrate.",
      }));
    } else if (!own(oldContent, mediaType) && own(newContent, mediaType)) {
      add(ctx, change("REQUEST_MEDIA_TYPE_ADDED", "non-breaking", "request-body", mediaLocation, `Request media type ${mediaType} is now accepted.`));
    } else {
      const oldMedia = asRecord(ctx.oldDocument, oldContent[mediaType]);
      const newMedia = asRecord(ctx.newDocument, newContent[mediaType]);
      compareSchema(ctx, oldMedia?.schema, newMedia?.schema, "request", `${mediaLocation}.schema`);
    }
  }
}

function responsesNode(document: OpenApiDocument, operation: Node): Node {
  return asRecord(document, operation.responses) ?? {};
}

function isSuccessStatus(status: string): boolean {
  return /^2(?:\d\d|XX)$/i.test(status);
}

function compareResponses(ctx: CompareContext, oldOperation: Node, newOperation: Node, base: string): void {
  const oldResponses = responsesNode(ctx.oldDocument, oldOperation);
  const newResponses = responsesNode(ctx.newDocument, newOperation);
  const responseKeys = [...new Set([...Object.keys(oldResponses), ...Object.keys(newResponses)])]
    .filter((key) => !/^x-/i.test(key))
    .sort();
  for (const status of responseKeys) {
    const location = `${base}.responses[${JSON.stringify(status)}]`;
    if (own(oldResponses, status) && !own(newResponses, status)) {
      add(ctx, change("RESPONSE_STATUS_REMOVED", isSuccessStatus(status) ? "breaking" : "potentially-breaking", "response", location, `Response status ${status} was removed.`, {
        recommendation: "Keep the old response documented and supported until consumers migrate.",
      }));
      continue;
    }
    if (!own(oldResponses, status) && own(newResponses, status)) {
      add(ctx, change("RESPONSE_STATUS_ADDED", isSuccessStatus(status) ? "potentially-breaking" : "non-breaking", "response", location,
        isSuccessStatus(status) ? `A new success response ${status} may require client handling.` : `Response status ${status} was added.`,
        { recommendation: isSuccessStatus(status) ? "Verify generated and handwritten clients accept every documented success status." : undefined }));
      continue;
    }
    const oldResponse = asRecord(ctx.oldDocument, oldResponses[status]);
    const newResponse = asRecord(ctx.newDocument, newResponses[status]);
    const oldContent = contentNode(ctx.oldDocument, oldResponse);
    const newContent = contentNode(ctx.newDocument, newResponse);
    for (const mediaType of [...new Set([...Object.keys(oldContent), ...Object.keys(newContent)])].sort()) {
      const mediaLocation = `${location}.content[${JSON.stringify(mediaType)}]`;
      if (own(oldContent, mediaType) && !own(newContent, mediaType)) {
        add(ctx, change("RESPONSE_MEDIA_TYPE_REMOVED", "breaking", "response", mediaLocation, `Response media type ${mediaType} was removed.`, {
          recommendation: "Continue producing the old representation until consumers migrate.",
        }));
      } else if (!own(oldContent, mediaType) && own(newContent, mediaType)) {
        add(ctx, change("RESPONSE_MEDIA_TYPE_ADDED", "non-breaking", "response", mediaLocation, `Response media type ${mediaType} was added.`));
      } else {
        const oldMedia = asRecord(ctx.oldDocument, oldContent[mediaType]);
        const newMedia = asRecord(ctx.newDocument, newContent[mediaType]);
        compareSchema(ctx, oldMedia?.schema, newMedia?.schema, "response", `${mediaLocation}.schema`);
      }
    }
  }
}

type NormalSecurity = Map<string, Set<string>>;

function normalizeSecurity(value: unknown): NormalSecurity[] {
  if (!Array.isArray(value) || value.length === 0) return [new Map()];
  const result: NormalSecurity[] = [];
  for (const rawRequirement of value) {
    if (!isRecord(rawRequirement)) continue;
    const requirement: NormalSecurity = new Map();
    for (const scheme of Object.keys(rawRequirement).sort()) {
      const scopes = asArray(rawRequirement[scheme]).filter((scope): scope is string => typeof scope === "string");
      requirement.set(scheme, new Set(scopes));
    }
    result.push(requirement);
  }
  return result.length === 0 ? [new Map()] : result;
}

/** True when candidate does not demand more credentials/scopes than baseline. */
function noStronger(candidate: NormalSecurity, baseline: NormalSecurity): boolean {
  for (const [scheme, candidateScopes] of candidate) {
    const baselineScopes = baseline.get(scheme);
    if (baselineScopes === undefined || !isSubset(candidateScopes, baselineScopes)) return false;
  }
  return true;
}

function securitySchemeNames(requirements: NormalSecurity[]): Set<string> {
  const names = new Set<string>();
  for (const requirement of requirements) {
    for (const name of requirement.keys()) names.add(name);
  }
  return names;
}

function securityScheme(document: OpenApiDocument, name: string): Node | undefined {
  const components = asRecord(document, document.components);
  const schemes = components === undefined
    ? undefined
    : asRecord(document, components.securitySchemes);
  return schemes === undefined ? undefined : asRecord(document, schemes[name]);
}

function normalizedLower(value: unknown): unknown {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function addSecuritySchemeDifference(
  ctx: CompareContext,
  name: string,
  field: string,
  before: unknown,
  after: unknown,
  severity: "breaking" | "potentially-breaking",
  message: string,
): void {
  add(ctx, change(
    "SECURITY_SCHEME_CHANGED",
    severity,
    "security",
    `components.securitySchemes[${JSON.stringify(name)}].${field}`,
    message,
    {
      before,
      after,
      recommendation: severity === "breaking"
        ? "Preserve the existing credential wire format or introduce a parallel security scheme during migration."
        : "Review authentication-client compatibility and test token acquisition before release.",
    },
  ));
}

function compareReferencedSecuritySchemes(
  ctx: CompareContext,
  oldRequirements: NormalSecurity[],
  newRequirements: NormalSecurity[],
): void {
  const oldNames = securitySchemeNames(oldRequirements);
  const newNames = securitySchemeNames(newRequirements);
  const commonNames = [...oldNames].filter((name) => newNames.has(name)).sort();

  for (const name of commonNames) {
    if (ctx.comparedSecuritySchemes.has(name)) continue;
    ctx.comparedSecuritySchemes.add(name);
    const oldScheme = securityScheme(ctx.oldDocument, name);
    const newScheme = securityScheme(ctx.newDocument, name);
    if (oldScheme === undefined || newScheme === undefined) {
      if (oldScheme !== newScheme) {
        addSecuritySchemeDifference(
          ctx,
          name,
          "$definition",
          oldScheme ?? "<missing>",
          newScheme ?? "<missing>",
          oldScheme !== undefined ? "breaking" : "potentially-breaking",
          `Referenced security scheme ${JSON.stringify(name)} is missing from one contract.`,
        );
      }
      continue;
    }

    if (!equal(oldScheme.type, newScheme.type)) {
      addSecuritySchemeDifference(ctx, name, "type", oldScheme.type, newScheme.type, "breaking",
        `Security scheme ${JSON.stringify(name)} changed type.`);
      continue;
    }

    if (oldScheme.type === "apiKey") {
      if (!equal(oldScheme.in, newScheme.in)) {
        addSecuritySchemeDifference(ctx, name, "in", oldScheme.in, newScheme.in, "breaking",
          `API key scheme ${JSON.stringify(name)} changed credential location.`);
      }
      const headerName = oldScheme.in === "header" && newScheme.in === "header";
      const oldName = headerName ? normalizedLower(oldScheme.name) : oldScheme.name;
      const newName = headerName ? normalizedLower(newScheme.name) : newScheme.name;
      if (!equal(oldName, newName)) {
        addSecuritySchemeDifference(ctx, name, "name", oldScheme.name, newScheme.name, "breaking",
          `API key scheme ${JSON.stringify(name)} changed credential name.`);
      }
    } else if (oldScheme.type === "http") {
      if (!equal(normalizedLower(oldScheme.scheme), normalizedLower(newScheme.scheme))) {
        addSecuritySchemeDifference(ctx, name, "scheme", oldScheme.scheme, newScheme.scheme, "breaking",
          `HTTP security scheme ${JSON.stringify(name)} changed authentication scheme.`);
      }
      if (!equal(oldScheme.bearerFormat, newScheme.bearerFormat)) {
        addSecuritySchemeDifference(ctx, name, "bearerFormat", oldScheme.bearerFormat, newScheme.bearerFormat, "potentially-breaking",
          `HTTP security scheme ${JSON.stringify(name)} changed bearer format.`);
      }
    } else if (oldScheme.type === "openIdConnect") {
      if (!equal(oldScheme.openIdConnectUrl, newScheme.openIdConnectUrl)) {
        addSecuritySchemeDifference(ctx, name, "openIdConnectUrl", oldScheme.openIdConnectUrl, newScheme.openIdConnectUrl, "potentially-breaking",
          `OpenID Connect scheme ${JSON.stringify(name)} changed discovery URL.`);
      }
    } else if (oldScheme.type === "oauth2" && !equal(oldScheme.flows, newScheme.flows)) {
      addSecuritySchemeDifference(ctx, name, "flows", oldScheme.flows, newScheme.flows, "potentially-breaking",
        `OAuth2 scheme ${JSON.stringify(name)} changed flows, endpoints, or declared scopes.`);
    }
  }
}

function compareSecurity(
  ctx: CompareContext,
  oldSecurity: unknown,
  newSecurity: unknown,
  location: string,
): void {
  const oldRequirements = normalizeSecurity(oldSecurity);
  const newRequirements = normalizeSecurity(newSecurity);
  compareReferencedSecuritySchemes(ctx, oldRequirements, newRequirements);
  if (equal(oldSecurity ?? [], newSecurity ?? [])) return;
  const everyOldCallerStillWorks = oldRequirements.every((oldRequirement) =>
    newRequirements.some((newRequirement) => noStronger(newRequirement, oldRequirement)));
  const everyNewCallerWorkedBefore = newRequirements.every((newRequirement) =>
    oldRequirements.some((oldRequirement) => noStronger(oldRequirement, newRequirement)));
  if (everyOldCallerStillWorks && everyNewCallerWorkedBefore) return;

  add(ctx, change(
    everyOldCallerStillWorks ? "SECURITY_RELAXED" : "SECURITY_STRENGTHENED",
    everyOldCallerStillWorks ? "non-breaking" : "breaking",
    "security",
    location,
    everyOldCallerStillWorks
      ? "Security requirements were relaxed or an authentication alternative was added."
      : "Some previously valid callers now need additional authentication or scopes.",
    {
      before: oldSecurity ?? [],
      after: newSecurity ?? [],
      recommendation: everyOldCallerStillWorks ? undefined : "Keep an old authentication alternative during migration or version the operation.",
    },
  ));
}

function compareMetadata(ctx: CompareContext, oldOperation: Node, newOperation: Node, base: string): void {
  if (!equal(oldOperation.operationId, newOperation.operationId)) {
    add(ctx, change("OPERATION_ID_CHANGED", "potentially-breaking", "metadata", `${base}.operationId`, "operationId changed and may rename generated SDK methods.", {
      before: oldOperation.operationId,
      after: newOperation.operationId,
      recommendation: "Preserve operationId or publish an SDK migration note.",
    }));
  }
  const oldDeprecated = oldOperation.deprecated === true;
  const newDeprecated = newOperation.deprecated === true;
  if (oldDeprecated !== newDeprecated) {
    add(ctx, change(
      newDeprecated ? "DEPRECATED_ADDED" : "DEPRECATED_REMOVED",
      newDeprecated ? "info" : "non-breaking",
      "metadata",
      `${base}.deprecated`,
      `The operation is ${newDeprecated ? "now" : "no longer"} deprecated.`,
      { before: oldDeprecated, after: newDeprecated },
    ));
  }
  for (const key of ["summary", "description"] as const) {
    if (!equal(oldOperation[key], newOperation[key])) {
      add(ctx, change("METADATA_CHANGED", "info", "metadata", `${base}.${key}`, `${key} changed.`, {
        before: oldOperation[key], after: newOperation[key],
      }));
    }
  }
}

function compareOperation(
  ctx: CompareContext,
  oldPathItem: Node,
  newPathItem: Node,
  oldOperation: Node,
  newOperation: Node,
  path: string,
  method: string,
): void {
  const base = operationLocation(path, method);
  compareMetadata(ctx, oldOperation, newOperation, base);
  compareParameters(ctx, oldPathItem, newPathItem, oldOperation, newOperation, base);
  compareRequestBody(ctx, oldOperation, newOperation, base);
  compareResponses(ctx, oldOperation, newOperation, base);
  const oldSecurity = own(oldOperation, "security") ? oldOperation.security : ctx.oldDocument.security;
  const newSecurity = own(newOperation, "security") ? newOperation.security : ctx.newDocument.security;
  compareSecurity(ctx, oldSecurity, newSecurity, `${base}.security`);
}

function comparePaths(ctx: CompareContext): void {
  const oldPaths = asRecord(ctx.oldDocument, ctx.oldDocument.paths) ?? {};
  const newPaths = asRecord(ctx.newDocument, ctx.newDocument.paths) ?? {};
  const pathNames = [...new Set([...Object.keys(oldPaths), ...Object.keys(newPaths)])]
    .filter((path) => path.startsWith("/"))
    .sort();
  for (const path of pathNames) {
    const location = `paths[${JSON.stringify(path)}]`;
    if (own(oldPaths, path) && !own(newPaths, path)) {
      add(ctx, change("PATH_REMOVED", "breaking", "path", location, `Path ${path} was removed.`, {
        recommendation: "Retain the endpoint through a deprecation window or publish a new API version.",
      }));
      continue;
    }
    if (!own(oldPaths, path) && own(newPaths, path)) {
      add(ctx, change("PATH_ADDED", "non-breaking", "path", location, `Path ${path} was added.`));
      continue;
    }
    const oldPathItem = asRecord(ctx.oldDocument, oldPaths[path]);
    const newPathItem = asRecord(ctx.newDocument, newPaths[path]);
    if (oldPathItem === undefined || newPathItem === undefined) continue;

    for (const method of HTTP_METHODS) {
      const oldOperation = asRecord(ctx.oldDocument, oldPathItem[method]);
      const newOperation = asRecord(ctx.newDocument, newPathItem[method]);
      if (oldOperation !== undefined && newOperation === undefined) {
        add(ctx, change("OPERATION_REMOVED", "breaking", "operation", operationLocation(path, method), `${method.toUpperCase()} ${path} was removed.`, {
          recommendation: "Keep the operation during a deprecation window or release a versioned replacement.",
        }));
      } else if (oldOperation === undefined && newOperation !== undefined) {
        add(ctx, change("OPERATION_ADDED", "non-breaking", "operation", operationLocation(path, method), `${method.toUpperCase()} ${path} was added.`));
      } else if (oldOperation !== undefined && newOperation !== undefined) {
        compareOperation(ctx, oldPathItem, newPathItem, oldOperation, newOperation, path, method);
      }
    }
  }
}

function sourceDescription(
  document: OpenApiDocument,
  fingerprint: AnalysisResult["source"]["old"]["fingerprint"],
): AnalysisResult["source"]["old"] {
  const result: AnalysisResult["source"]["old"] = { openapi: document.openapi, fingerprint };
  if (typeof document.info?.title === "string") result.title = document.info.title;
  if (typeof document.info?.version === "string") result.version = document.info.version;
  return result;
}

function finalizeChanges(changes: DraftChange[]): Change[] {
  const severityOrder: Record<Severity, number> = {
    breaking: 0,
    "potentially-breaking": 1,
    "non-breaking": 2,
    info: 3,
  };
  return changes
    .sort((left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity]
      || compareText(left.location, right.location)
      || compareText(left.ruleId, right.ruleId)
      || compareText(stable(left.before), stable(right.before)))
    .map((item, index) => ({ id: `CG-${String(index + 1).padStart(4, "0")}`, ...item }));
}

/**
 * Analyze provider-side backward compatibility: can callers built against oldSpec
 * continue to call, and parse responses from, newSpec?
 */
export function analyzeCompatibility(
  oldSpec: OpenApiInput,
  newSpec: OpenApiInput,
  options: AnalyzeOptions = {},
): AnalysisResult {
  const oldFingerprint = fingerprintOpenApiInput(oldSpec);
  const newFingerprint = fingerprintOpenApiInput(newSpec);
  const oldDocument = parseOpenApi(oldSpec).document;
  const newDocument = parseOpenApi(newSpec).document;
  const policy = resolveRulePolicy(options.policy);
  const ctx: CompareContext = {
    oldDocument,
    newDocument,
    changes: [],
    comparedSecuritySchemes: new Set<string>(),
    policy,
    options: {
      includeInfo: options.includeInfo ?? true,
      includeNonBreaking: options.includeNonBreaking ?? true,
    },
  };
  comparePaths(ctx);
  const changes = finalizeChanges(ctx.changes);
  const summary = {
    total: changes.length,
    breaking: changes.filter((item) => item.severity === "breaking").length,
    potentiallyBreaking: changes.filter((item) => item.severity === "potentially-breaking").length,
    nonBreaking: changes.filter((item) => item.severity === "non-breaking").length,
    info: changes.filter((item) => item.severity === "info").length,
  };
  const risk = changes.reduce((total, item) => total + policy.scoring[item.severity], 0);
  const timestamp = options.generatedAt instanceof Date
    ? options.generatedAt.toISOString()
    : typeof options.generatedAt === "string"
      ? new Date(options.generatedAt).toISOString()
      : new Date().toISOString();
  return {
    engineVersion: ENGINE_VERSION,
    generatedAt: timestamp,
    policy: policy.metadata,
    source: {
      old: sourceDescription(oldDocument, oldFingerprint),
      new: sourceDescription(newDocument, newFingerprint),
    },
    score: Math.max(0, 100 - Math.min(100, risk)),
    compatible: summary.breaking === 0,
    summary,
    changes,
  };
}
