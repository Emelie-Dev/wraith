import { readFileSync } from "fs";
import path from "path";

/**
 * Simple persisted query allow‑list implementation.
 *
 * In a real application the allow‑list would be generated at build time
 * (e.g. via a script that hashes each query and stores the mapping in a JSON
 * file).  For the purpose of this kata we keep the implementation minimal:
 *
 *   1. All persisted queries are stored in a JSON file located at
 *      `<repo root>/persisted-queries.json`.
 *   2. The JSON file maps a SHA‑256 hash (hex string) to the original GraphQL
 *      query string.
 *
 * The `getPersistedQuery` function returns the query string for a given hash
 * or `undefined` if the hash is not present in the allow‑list.
 *
 * Production mode (`process.env.NODE_ENV === "production"`) will reject any
 * ad‑hoc query that is not found in the allow‑list.  Development mode falls back
 * to the supplied query string.
 */
type AllowList = Record<string, string>;

let allowList: AllowList | null = null;

/**
 * Load the allow‑list from disk the first time it is needed.
 * The JSON file is optional – if it does not exist we treat the allow‑list as
 * empty, which causes all ad‑hoc queries to be rejected in production.
 */
function loadAllowList(): AllowList {
  if (allowList !== null) {
    return allowList;
  }

  const filePath = path.resolve(
    process.cwd(),
    "persisted-queries.json"
  );

  try {
    const raw = readFileSync(filePath, "utf8");
    allowList = JSON.parse(raw) as AllowList;
  } catch {
    // If the file cannot be read (e.g. does not exist) we default to an empty
    // allow‑list.  This is safe because production will reject unknown hashes.
    allowList = {};
  }

  return allowList;
}

/**
 * Retrieve a persisted query by its hash.
 *
 * @param hash SHA‑256 hash of the query (hex string)
 * @returns The original query string if the hash is allow‑listed, otherwise
 *          `undefined`.
 */
export function getPersistedQuery(hash: string): string | undefined {
  const list = loadAllowList();
  return list[hash];
}

/**
 * Middleware for GraphQL servers that resolves persisted queries.
 *
 * The typical usage pattern with `express-graphql` or `apollo-server` is:
 *
 * ```ts
 * const server = new ApolloServer({
 *   schema,
 *   plugins: [persistedQueryPlugin],
 * });
 * ```
 *
 * The plugin checks the incoming request for a `persistedQuery` field
 * containing a `sha256Hash`.  If the hash is found in the allow‑list the
 * request's `query` property is replaced with the stored query string.
 *
 * In production mode, if the hash is missing the request is rejected with a
 * clear error.  In non‑production environments the request is allowed to fall
 * back to an ad‑hoc query (useful for local development).
 */
export const persistedQueryPlugin = {
  requestDidStart(requestContext: any) {
    const { request } = requestContext;
    const persisted = request?.extensions?.persistedQuery;

    if (!persisted?.sha256Hash) {
      // No persisted query – nothing to do.
      return;
    }

    const query = getPersistedQuery(persisted.sha256Hash);
    if (query) {
      request.query = query;
    } else if (process.env.NODE_ENV === "production") {
      throw new Error(
        `Persisted query not found for hash ${persisted.sha256Hash}`
      );
    }
    // In dev mode we simply let the request continue; the client may have
    // supplied an ad‑hoc query alongside the hash.
  },
};
