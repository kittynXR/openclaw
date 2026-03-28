/**
 * Cross-platform identity manager for the streaming skill.
 *
 * Manages Twitch <-> Discord user identity links stored in
 * ~/.openclaw/state/streaming-identities.json
 *
 * Usage:
 *   bun skills/streaming/scripts/identity-manager.ts link --twitch-id 123 --discord-id 456
 *   bun skills/streaming/scripts/identity-manager.ts unlink --id user_001
 *   bun skills/streaming/scripts/identity-manager.ts find --twitch-id 123
 *   bun skills/streaming/scripts/identity-manager.ts find --discord-id 456
 *   bun skills/streaming/scripts/identity-manager.ts list
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────

interface TwitchIdentity {
	userId: string;
	username: string;
	displayName: string;
}

interface DiscordIdentity {
	userId: string;
	username: string;
	displayName: string;
}

type LinkMethod = "manual" | "auto-match" | "twitch-discord-connection";

interface Identity {
	id: string;
	twitch: TwitchIdentity;
	discord: DiscordIdentity;
	linkedAt: string;
	linkMethod: LinkMethod;
}

interface IdentityStore {
	identities: Identity[];
}

// ── Paths ──────────────────────────────────────────────────────────

const STATE_DIR = join(homedir(), ".openclaw", "state");
const STORE_PATH = join(STATE_DIR, "streaming-identities.json");

// ── Store I/O ──────────────────────────────────────────────────────

function loadIdentities(): IdentityStore {
	if (!existsSync(STORE_PATH)) {
		return { identities: [] };
	}
	const raw = readFileSync(STORE_PATH, "utf-8");
	return JSON.parse(raw) as IdentityStore;
}

function saveIdentities(store: IdentityStore): void {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

// ── Operations ─────────────────────────────────────────────────────

function nextId(store: IdentityStore): string {
	const maxNum = store.identities.reduce((max, identity) => {
		const num = parseInt(identity.id.replace("user_", ""), 10);
		return Number.isNaN(num) ? max : Math.max(max, num);
	}, 0);
	return `user_${String(maxNum + 1).padStart(3, "0")}`;
}

function linkUser(
	twitch: TwitchIdentity,
	discord: DiscordIdentity,
	method: LinkMethod = "manual",
): Identity {
	const store = loadIdentities();

	// Check for existing link with either account
	const existing = store.identities.find(
		(i) =>
			i.twitch.userId === twitch.userId ||
			i.discord.userId === discord.userId,
	);
	if (existing) {
		throw new Error(
			`User already linked: ${existing.id} (Twitch: ${existing.twitch.username}, Discord: ${existing.discord.username})`,
		);
	}

	const identity: Identity = {
		id: nextId(store),
		twitch,
		discord,
		linkedAt: new Date().toISOString(),
		linkMethod: method,
	};

	store.identities.push(identity);
	saveIdentities(store);
	return identity;
}

function unlinkUser(identityId: string): boolean {
	const store = loadIdentities();
	const idx = store.identities.findIndex((i) => i.id === identityId);
	if (idx === -1) return false;
	store.identities.splice(idx, 1);
	saveIdentities(store);
	return true;
}

function findByTwitchId(twitchUserId: string): Identity | undefined {
	const store = loadIdentities();
	return store.identities.find((i) => i.twitch.userId === twitchUserId);
}

function findByDiscordId(discordUserId: string): Identity | undefined {
	const store = loadIdentities();
	return store.identities.find((i) => i.discord.userId === discordUserId);
}

function autoMatchByUsername(
	twitchUsername: string,
	discordUsername: string,
): boolean {
	return twitchUsername.toLowerCase() === discordUsername.toLowerCase();
}

function listIdentities(): Identity[] {
	return loadIdentities().identities;
}

// ── CLI ────────────────────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--") && i + 1 < args.length) {
			const key = arg.slice(2);
			result[key] = args[++i];
		}
	}
	return result;
}

function main(): void {
	const [command, ...rest] = process.argv.slice(2);
	const flags = parseArgs(rest);

	switch (command) {
		case "link": {
			if (
				!flags["twitch-id"] ||
				!flags["twitch-name"] ||
				!flags["discord-id"] ||
				!flags["discord-name"]
			) {
				console.error(
					"Usage: link --twitch-id ID --twitch-name NAME --discord-id ID --discord-name NAME [--method manual|auto-match|twitch-discord-connection]",
				);
				process.exit(1);
			}
			const identity = linkUser(
				{
					userId: flags["twitch-id"],
					username: flags["twitch-name"].toLowerCase(),
					displayName: flags["twitch-name"],
				},
				{
					userId: flags["discord-id"],
					username: flags["discord-name"].toLowerCase(),
					displayName: flags["discord-name"],
				},
				(flags["method"] as LinkMethod) || "manual",
			);
			console.log(`Linked: ${identity.id}`);
			console.log(JSON.stringify(identity, null, 2));
			break;
		}

		case "unlink": {
			if (!flags["id"]) {
				console.error("Usage: unlink --id IDENTITY_ID");
				process.exit(1);
			}
			const removed = unlinkUser(flags["id"]);
			console.log(removed ? `Unlinked: ${flags["id"]}` : "Not found");
			break;
		}

		case "find": {
			let result: Identity | undefined;
			if (flags["twitch-id"]) {
				result = findByTwitchId(flags["twitch-id"]);
			} else if (flags["discord-id"]) {
				result = findByDiscordId(flags["discord-id"]);
			} else {
				console.error("Usage: find --twitch-id ID or find --discord-id ID");
				process.exit(1);
			}
			if (result) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				console.log("No linked identity found");
			}
			break;
		}

		case "match": {
			if (!flags["twitch-name"] || !flags["discord-name"]) {
				console.error(
					"Usage: match --twitch-name NAME --discord-name NAME",
				);
				process.exit(1);
			}
			const isMatch = autoMatchByUsername(
				flags["twitch-name"],
				flags["discord-name"],
			);
			console.log(
				isMatch
					? `Match: "${flags["twitch-name"]}" and "${flags["discord-name"]}" are the same user (by username)`
					: `No match: usernames differ`,
			);
			break;
		}

		case "list": {
			const identities = listIdentities();
			if (identities.length === 0) {
				console.log("No linked identities");
			} else {
				for (const identity of identities) {
					console.log(
						`${identity.id}: Twitch ${identity.twitch.username} <-> Discord ${identity.discord.username} (${identity.linkMethod})`,
					);
				}
			}
			break;
		}

		default:
			console.error(
				"Commands: link, unlink, find, match, list\n" +
					"Run with --help after a command for usage.",
			);
			process.exit(1);
	}
}

// ── Exports (for programmatic use) ─────────────────────────────────

export {
	autoMatchByUsername,
	findByDiscordId,
	findByTwitchId,
	linkUser,
	listIdentities,
	loadIdentities,
	saveIdentities,
	unlinkUser,
};
export type {
	DiscordIdentity,
	Identity,
	IdentityStore,
	LinkMethod,
	TwitchIdentity,
};

main();
