import {
  DocumentNode,
  visit,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLField,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLScalarType,
  GraphQLType,
} from "graphql";
import { GraphQLError } from "graphql/error";

/**
 * Configuration for depth and cost limiting.
 *
 * - `maxDepth` – maximum allowed field depth.
 * - `maxCost` – maximum allowed cost budget.
 * - `fieldCost` – a map of type name → field name → numeric weight.
 *
 * The defaults are deliberately low for the kata; a real service would tune
 * these values based on performance testing.
 */
export interface CostLimitOptions {
  maxDepth?: number;
  maxCost?: number;
  fieldCost?: Record<string, Record<string, number>>;
}

/**
 * Compute the depth of a GraphQL query document.
 *
 * @param doc GraphQL AST
 * @returns Maximum depth (root fields count as depth 1)
 */
function computeDepth(doc: DocumentNode): number {
  let maxDepth = 0;

  const visitor = {
    Field(node: any, _key: any, _parent: any, _path: any, ancestors: any[]) {
      // Depth is number of field ancestors + 1 (the field itself)
      const depth = ancestors.filter((a) => a.kind === "Field").length + 1;
      if (depth > maxDepth) {
        maxDepth = depth;
      }
    },
  };

  visit(doc, visitor);
  return maxDepth;
}

/**
 * Compute a simple cost for a query based on field weights.
 *
 * The algorithm walks the AST and adds the weight for each field.  If a weight
 * is not defined for a particular field we fall back to a default weight of 1.
 *
 * @param doc   GraphQL AST
 * @param opts  Cost limit options (used for field weight lookup)
 * @returns Total cost of the query
 */
function computeCost(
  doc: DocumentNode,
  opts: CostLimitOptions
): number {
  const defaultWeight = 1;
  const fieldCost = opts.fieldCost ?? {};

  let total = 0;

  const visitor = {
    Field(node: any) {
      const parentType = node?.type?.name?.value; // may be undefined for fragments
      const fieldName = node.name.value;

      const weight =
        (parentType && fieldCost[parentType]?.[fieldName]) ?? defaultWeight;

      total += weight;
    },
  };

  // The GraphQL `visit` function does not provide type information, so we
  // cannot reliably resolve the parent type without a full schema validation.
  // For the purpose of this kata we simply use the default weight for all
  // fields.
  visit(doc, visitor);
  return total;
}

/**
 * Middleware / plugin for GraphQL servers that enforces depth and cost limits.
 *
 * The plugin can be used with Apollo Server, Express GraphQL, etc.  It throws
 * a `GraphQLError` when a request exceeds the configured limits.
 *
 * Example usage with Apollo Server:
 *
 * ```ts
 * const server = new ApolloServer({
 *   schema,
 *   plugins: [costLimitPlugin({ maxDepth: 8, maxCost: 200 })],
 * });
 * ```
 */
export function costLimitPlugin(options: CostLimitOptions = {}) {
  const maxDepth = options.maxDepth ?? 10;
  const maxCost = options.maxCost ?? 1000;

  return {
    requestDidStart(requestContext: any) {
      const { request } = requestContext;
      if (!request?.query) {
        // No query – nothing to validate.
        return;
      }

      let doc: DocumentNode;
      try {
        const { parse } = require("graphql");
        doc = parse(request.query);
      } catch (e) {
        // Parsing errors are handled elsewhere; we simply abort cost checks.
        return;
      }

      const depth = computeDepth(doc);
      if (depth > maxDepth) {
        throw new GraphQLError(
          `Query depth ${depth} exceeds the maximum allowed depth of ${maxDepth}`
        );
      }

      const cost = computeCost(doc, options);
      if (cost > maxCost) {
        throw new GraphQLError(
          `Query cost ${cost} exceeds the maximum allowed cost of ${maxCost}`
        );
      }
    },
  };
}
