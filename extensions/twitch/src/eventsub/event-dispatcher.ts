/**
 * Typed event dispatcher for EventSub notifications.
 *
 * Receives raw EventSub notification payloads from the shard pool and emits
 * them as typed events that consumers (monitor, skill layer) can subscribe to.
 */

import type { ChannelLogSink } from "../types.js";
import type { EventSubEventMap, EventSubSubscriptionType } from "./types.js";

type Handler<T = unknown> = (data: T) => void;

/**
 * Type-safe event dispatcher for Twitch EventSub events.
 *
 * Consumers register handlers for specific subscription types and receive
 * strongly-typed event payloads.
 */
export class EventDispatcher {
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly logger: ChannelLogSink;

  constructor(logger: ChannelLogSink) {
    this.logger = logger;
  }

  /**
   * Register a typed handler for an EventSub subscription type.
   *
   * @returns Unsubscribe function.
   */
  on<K extends EventSubSubscriptionType>(
    type: K,
    handler: Handler<EventSubEventMap[K]>,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler);

    return () => {
      set!.delete(handler as Handler);
      if (set!.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  /**
   * Register a wildcard handler that receives all events.
   *
   * The handler receives the subscription type string and the raw event payload.
   *
   * @returns Unsubscribe function.
   */
  onAny(handler: (type: string, data: unknown) => void): () => void {
    return this.on("*" as EventSubSubscriptionType, handler as Handler);
  }

  /**
   * Dispatch a raw EventSub notification to registered handlers.
   *
   * Called by the shard pool when a notification message is received.
   */
  dispatch(subscriptionType: string, event: unknown): void {
    this.logger.debug?.(`EventSub dispatch: ${subscriptionType}`);

    const handlers = this.handlers.get(subscriptionType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          this.logger.error(`EventSub handler error for ${subscriptionType}: ${String(err)}`);
        }
      }
    }

    // Wildcard handlers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          (handler as (type: string, data: unknown) => void)(subscriptionType, event);
        } catch (err) {
          this.logger.error(`EventSub wildcard handler error: ${String(err)}`);
        }
      }
    }
  }

  /** Remove all handlers. */
  removeAllListeners(): void {
    this.handlers.clear();
  }
}
