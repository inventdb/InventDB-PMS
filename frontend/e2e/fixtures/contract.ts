import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Responses the real backend produced, for the mock to serve verbatim.
 *
 * `backend/tests/contract/` replays recorded InventDB payloads through the
 * actual Flask app and writes what came out to `contract/responses/`. Anything
 * the mock can serve from there is one less fixture that can quietly disagree
 * with production.
 *
 * This is for the *envelope* endpoints — metadata and other responses the
 * backend composes itself. Record data stays in `data.ts`, because those
 * fixtures exist to drive assertions on specific rendered values and a captured
 * dataset would change them every time somebody edited the sandbox.
 *
 * Route handlers run in Node, not the browser, so reading from disk here is
 * fine.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESPONSES_DIR = path.resolve(HERE, "../../../contract/responses");

export function backendResponse<T = unknown>(key: string): T {
  const file = path.join(RESPONSES_DIR, `${key}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${file}. Regenerate it with:\n` +
        `  cd backend && UPDATE_CONTRACT=1 python -m pytest tests/contract`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
