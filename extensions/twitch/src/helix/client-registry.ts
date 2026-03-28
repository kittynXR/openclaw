/**
 * Helix API client registry.
 *
 * Stores HelixApiClient instances keyed by accountId so action handlers can
 * look up the correct client without threading it through every call site.
 */

import type { HelixApiClient } from "./api-client.js";

const registry = new Map<string, HelixApiClient>();

/** Register a Helix API client for an account. */
export function setHelixClient(accountId: string, client: HelixApiClient): void {
  registry.set(accountId, client);
}

/** Get the Helix API client for an account. */
export function getHelixClient(accountId: string): HelixApiClient | undefined {
  return registry.get(accountId);
}

/** Remove and return the Helix API client for an account. */
export function removeHelixClient(accountId: string): void {
  registry.delete(accountId);
}

/** Remove all registered clients. */
export function removeAllHelixClients(): void {
  registry.clear();
}
