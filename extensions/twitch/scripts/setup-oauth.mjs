#!/usr/bin/env node
/**
 * Twitch OAuth Setup Script
 * 
 * Launches a local HTTP server, opens the browser for Twitch OAuth authorization,
 * catches the callback, exchanges the code for tokens, and writes them to the
 * OpenClaw config file.
 * 
 * Usage:
 *   node extensions/twitch/scripts/setup-oauth.mjs [--broadcaster] [--bot]
 * 
 * --broadcaster: Auth as the channel broadcaster (for EventSub + API)
 * --bot:         Auth as the bot account (for chat)
 * --both:        Auth both accounts sequentially (default)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";

// ─── Config ─────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");
const PORT = 17563;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const BROADCASTER_SCOPES = [
  "channel:read:subscriptions",
  "bits:read",
  "channel:read:hype_train",
  "channel:read:redemptions",
  "channel:read:polls",
  "channel:read:predictions",
  "channel:manage:polls",
  "channel:manage:predictions",
  "channel:manage:broadcast",
  "channel:manage:redemptions",
  "moderator:read:chatters",
  "moderator:read:followers",
  "moderator:manage:banned_users",
  "moderator:manage:announcements",
  "moderator:manage:shoutouts",
  "clips:edit",
  "channel:read:vips",
  "user:read:chat",
  "user:write:chat",
  "channel:moderate",
];

const BOT_SCOPES = [
  "user:read:chat",
  "user:write:chat",
  "user:bot",
  "moderator:read:chatters",
  "moderator:manage:banned_users",
  "moderator:manage:announcements",
  "moderator:manage:shoutouts",
  "clips:edit",
];

// ─── Helpers ────────────────────────────────────────────────────────────

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" 
    : process.platform === "win32" ? "start" 
    : "xdg-open";
  exec(`${cmd} "${url}"`, (err) => {
    if (err) {
      console.log(`\n⚠️  Could not open browser automatically.`);
      console.log(`   Open this URL manually:\n`);
      console.log(`   ${url}\n`);
    }
  });
}

async function exchangeCode(code, clientId, clientSecret) {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });
  
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function validateToken(accessToken) {
  const res = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  return await res.json();
}

async function getUserId(accessToken, clientId) {
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
    },
  });
  const data = await res.json();
  return data.data?.[0];
}

// ─── OAuth Flow ─────────────────────────────────────────────────────────

function runOAuthFlow(clientId, scopes, label) {
  return new Promise((resolve, reject) => {
    const state = Math.random().toString(36).slice(2);
    
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        
        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<html><body><h1>❌ Authorization denied</h1><p>${error}</p><p>You can close this tab.</p></body></html>`);
          server.close();
          reject(new Error(`OAuth denied: ${error}`));
          return;
        }
        
        if (returnedState !== state) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<html><body><h1>❌ State mismatch</h1><p>Security check failed. Try again.</p></body></html>`);
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }
        
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>✅ ${label} authorized!</h1><p>Exchanging token... You can close this tab.</p></body></html>`);
        server.close();
        resolve(code);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    
    server.listen(PORT, () => {
      const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scopes.join("+")}&state=${state}&force_verify=true`;
      
      console.log(`\n🔐 Opening browser for ${label} authorization...`);
      console.log(`   Log in as the ${label.toLowerCase()} account on Twitch.\n`);
      openBrowser(authUrl);
    });
    
    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout — no callback received within 5 minutes"));
    }, 300_000);
  });
}

// ─── Interactive Prompts ────────────────────────────────────────────────

import { createInterface } from "node:readline";

function prompt(question, defaultValue) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

async function promptSecret(question, defaultValue) {
  // Show masked version of existing value
  const masked = defaultValue ? `[${defaultValue.slice(0, 4)}...${defaultValue.slice(-4)}]` : "";
  const display = masked ? `${question} ${masked} (Enter to keep): ` : `${question}: `;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

// ─── Main ───────────────────────────────────────────────────────────────

async function ensureAppCredentials(config) {
  const twitch = config.channels?.twitch ?? {};
  
  console.log("\n📋 Step 1: Twitch Application Credentials");
  console.log("   Create an app at https://dev.twitch.tv/console if you haven't already.");
  console.log(`   Add this OAuth Redirect URL to your app: ${REDIRECT_URI}\n`);
  
  const clientId = await prompt("Client ID", twitch.clientId);
  const clientSecret = await promptSecret("Client Secret", twitch.clientSecret);
  
  if (!clientId || !clientSecret) {
    console.error("\n❌ Both Client ID and Client Secret are required.");
    process.exit(1);
  }
  
  // Verify credentials work
  console.log("\n🔄 Verifying app credentials...");
  try {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || JSON.stringify(data));
    console.log(`✅ App credentials valid (token expires in ${data.expires_in}s)`);
  } catch (err) {
    console.error(`\n❌ Invalid credentials: ${err.message}`);
    process.exit(1);
  }
  
  twitch.clientId = clientId;
  twitch.clientSecret = clientSecret;
  twitch.enabled = true;
  
  // Ensure eventsub + api blocks exist
  twitch.eventsub = twitch.eventsub ?? { enabled: true, shardCount: 1 };
  twitch.api = twitch.api ?? { enabled: true };
  
  config.channels = config.channels ?? {};
  config.channels.twitch = twitch;
  saveConfig(config);
  
  return { clientId, clientSecret };
}

async function setupAccount(config, role, scopes, clientId, clientSecret) {
  const twitch = config.channels.twitch;

  console.log(`\n⚠️  Make sure ${REDIRECT_URI} is listed as an OAuth Redirect URL`);
  console.log(`   in your Twitch app at https://dev.twitch.tv/console\n`);
  
  const label = role === "broadcaster" ? "Broadcaster" : "Bot";
  
  await prompt(`Press Enter to open browser for ${label} authorization...`, "");
  
  const code = await runOAuthFlow(clientId, scopes, label);
  
  console.log(`\n🔄 Exchanging authorization code for tokens...`);
  const tokens = await exchangeCode(code, clientId, clientSecret);
  
  // Validate and get user info
  const validation = await validateToken(tokens.access_token);
  
  console.log(`✅ Token obtained!`);
  console.log(`   User: ${validation.login} (ID: ${validation.user_id})`);
  console.log(`   Scopes: ${validation.scopes.length}`);
  console.log(`   Expires in: ${tokens.expires_in}s`);
  
  // Update config
  if (role === "broadcaster") {
    twitch.broadcasterAccessToken = tokens.access_token;
    twitch.broadcasterRefreshToken = tokens.refresh_token;
    twitch.broadcasterId = validation.user_id;
    twitch.channel = validation.login;
    console.log(`\n📝 Saved: broadcasterAccessToken, broadcasterRefreshToken, broadcasterId="${validation.user_id}", channel="${validation.login}"`);
  } else {
    twitch.accessToken = tokens.access_token;
    twitch.refreshToken = tokens.refresh_token;
    twitch.username = validation.login;
    if (tokens.expires_in) twitch.expiresIn = tokens.expires_in;
    twitch.obtainmentTimestamp = Date.now();
    twitch.requireMention = twitch.requireMention ?? true;
    console.log(`\n📝 Saved: accessToken, refreshToken, username="${validation.login}"`);
  }
  
  config.channels.twitch = twitch;
  saveConfig(config);
  console.log(`💾 Config saved to ${CONFIG_PATH}`);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--broadcaster") ? "broadcaster"
    : args.includes("--bot") ? "bot"
    : "both";
  
  console.log("═══════════════════════════════════════════════════");
  console.log("  🔐 Twitch OAuth Setup Wizard");
  console.log("═══════════════════════════════════════════════════");
  
  let config = loadConfig();
  
  // Step 1: App credentials
  const { clientId, clientSecret } = await ensureAppCredentials(config);
  
  // Step 2: Broadcaster auth
  if (mode === "both" || mode === "broadcaster") {
    console.log("\n───────────────────────────────────────────────────");
    console.log("  📋 Step 2: Broadcaster Authorization");
    console.log("  Log in as your BROADCASTER account (channel owner).");
    console.log("  This grants EventSub access to your channel events.");
    console.log("───────────────────────────────────────────────────");
    
    config = loadConfig(); // reload
    await setupAccount(config, "broadcaster", BROADCASTER_SCOPES, clientId, clientSecret);
  }
  
  // Step 3: Bot auth
  if (mode === "both" || mode === "bot") {
    console.log("\n───────────────────────────────────────────────────");
    console.log("  📋 Step 3: Bot Account Authorization");
    console.log("  Log in as your BOT account (the one that sends messages).");
    console.log("  If same as broadcaster, just authorize again.");
    console.log("───────────────────────────────────────────────────");
    
    config = loadConfig(); // reload
    await setupAccount(config, "bot", BOT_SCOPES, clientId, clientSecret);
  }
  
  // Summary
  config = loadConfig();
  const tw = config.channels.twitch;
  
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅ Twitch Setup Complete!");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Channel:     ${tw.channel ?? "not set"}`);
  console.log(`  Broadcaster: ${tw.broadcasterId ?? "not set"}`);
  console.log(`  Bot:         ${tw.username ?? "not set"}`);
  console.log(`  EventSub:    ${tw.eventsub?.enabled ? "enabled" : "disabled"}`);
  console.log(`  Helix API:   ${tw.api?.enabled ? "enabled" : "disabled"}`);
  console.log("═══════════════════════════════════════════════════");
  console.log("\nRestart the gateway to apply: openclaw gateway restart");
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
