#!/usr/bin/env node
/**
 * Stream Vision Eval — Round-robin screenshot + analysis for model comparison.
 *
 * Every 60 seconds while the stream is live:
 * 1. Capture a frame via HLS
 * 2. Send to the next model in rotation (llava:13b → sonnet → opus → repeat)
 * 3. Log results to a JSONL file for post-stream comparison
 *
 * Usage:
 *   node stream-vision-eval.mjs [channel] [--interval 60]
 *
 * Results saved to: ~/.openclaw/state/vision-eval/eval-{timestamp}.jsonl
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Config ─────────────────────────────────────────────────────────────

const CHANNEL = process.argv[2] || "kittyn";
const INTERVAL_MS = (parseInt(process.argv.find((a, i) => process.argv[i - 1] === "--interval") || "60")) * 1000;

const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const OLLAMA_URL = "http://localhost:11434";

const VISION_PROMPT = "Describe what you see in this stream screenshot in 2-3 sentences. Include: the game/application visible, what's happening on screen, any text or UI elements, number of people/avatars visible, and the general mood/atmosphere.";

const MODELS = [
  { name: "llava:13b", type: "ollama" },
  { name: "claude-sonnet-4-20250514", type: "anthropic" },
  { name: "claude-opus-4-20250514", type: "anthropic" },
];

const CAPTURE_DIR = join(homedir(), ".openclaw", "state", "stream-captures");
const EVAL_DIR = join(homedir(), ".openclaw", "state", "vision-eval");

// Load Anthropic API key
function getAnthropicKey() {
  // Try environment first
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // Try openclaw config
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".openclaw", "openclaw.json"), "utf-8"));
    // Check auth profiles or common locations
    const profiles = cfg.auth?.profiles ?? {};
    for (const [, profile] of Object.entries(profiles)) {
      if (profile.provider === "anthropic" && profile.token) return profile.token;
    }
  } catch {}
  // Try credentials file
  try {
    const credsDir = join(homedir(), ".openclaw", "credentials");
    const files = ["anthropic.json", "anthropic"];
    for (const f of files) {
      const p = join(credsDir, f);
      if (existsSync(p)) {
        const data = readFileSync(p, "utf-8").trim();
        try { return JSON.parse(data).apiKey || JSON.parse(data).token || data; }
        catch { return data; }
      }
    }
  } catch {}
  return null;
}

// ─── HLS Capture ────────────────────────────────────────────────────────

async function getPlaybackToken(channel) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Client-ID": TWITCH_GQL_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify([{
      operationName: "PlaybackAccessToken_Template",
      query: `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {
        streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {
          value signature __typename
        }
      }`,
      variables: { isLive: true, login: channel, isVod: false, vodID: "", playerType: "site" },
    }]),
  });
  const data = await res.json();
  const token = data[0]?.data?.streamPlaybackAccessToken;
  if (!token) return null; // offline
  return { token: token.value, sig: token.signature };
}

async function getHlsUrl(channel) {
  const auth = await getPlaybackToken(channel);
  if (!auth) return null;

  const params = new URLSearchParams({
    allow_source: "true", fast_bread: "true",
    p: String(Math.floor(Math.random() * 999999)),
    player_backend: "mediaplayer", sig: auth.sig, token: auth.token,
  });
  const url = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${params}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const playlist = await res.text();
  for (const line of playlist.split("\n")) {
    if (line.trim().startsWith("https://")) return line.trim();
  }
  return null;
}

function captureFrame(hlsUrl, outputPath) {
  execSync(`ffmpeg -y -i "${hlsUrl}" -frames:v 1 -q:v 2 "${outputPath}" 2>/dev/null`, { timeout: 15000 });
}

// ─── Vision Models ──────────────────────────────────────────────────────

async function analyzeWithOllama(imagePath, model) {
  const imageBase64 = readFileSync(imagePath).toString("base64");
  const start = Date.now();

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: VISION_PROMPT,
      images: [imageBase64],
      stream: false,
    }),
  });

  const data = await res.json();
  const elapsed = Date.now() - start;

  return {
    response: data.response,
    elapsed_ms: elapsed,
    tokens_eval: data.eval_count,
    tokens_prompt: data.prompt_eval_count,
  };
}

async function analyzeWithAnthropic(imagePath, model, apiKey) {
  const imageBase64 = readFileSync(imagePath).toString("base64");
  const start = Date.now();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
          { type: "text", text: VISION_PROMPT },
        ],
      }],
    }),
  });

  const data = await res.json();
  const elapsed = Date.now() - start;

  return {
    response: data.content?.[0]?.text ?? data.error?.message ?? "ERROR",
    elapsed_ms: elapsed,
    input_tokens: data.usage?.input_tokens,
    output_tokens: data.usage?.output_tokens,
  };
}

// ─── Main Loop ──────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

async function main() {
  if (!existsSync(CAPTURE_DIR)) mkdirSync(CAPTURE_DIR, { recursive: true });
  if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });

  const anthropicKey = getAnthropicKey();
  if (!anthropicKey) {
    console.error("⚠️  No Anthropic API key found. Set ANTHROPIC_API_KEY env var.");
    console.error("   Sonnet and Opus evals will be skipped.");
  }

  const evalFile = join(EVAL_DIR, `eval-${Date.now()}.jsonl`);
  let modelIndex = 0;
  let captureCount = 0;

  console.log("═══════════════════════════════════════════════════");
  console.log("  📸 Stream Vision Eval");
  console.log(`  Channel: ${CHANNEL}`);
  console.log(`  Interval: ${INTERVAL_MS / 1000}s`);
  console.log(`  Models: ${MODELS.map(m => m.name).join(" → ")}`);
  console.log(`  Output: ${evalFile}`);
  console.log("═══════════════════════════════════════════════════\n");

  async function tick() {
    const model = MODELS[modelIndex % MODELS.length];
    modelIndex++;

    // Skip anthropic models if no key
    if (model.type === "anthropic" && !anthropicKey) {
      log(`Skipping ${model.name} (no API key)`);
      return;
    }

    // Check if live + get HLS URL
    const hlsUrl = await getHlsUrl(CHANNEL);
    if (!hlsUrl) {
      log(`${CHANNEL} is offline — waiting...`);
      return;
    }

    // Capture frame
    const timestamp = Date.now();
    const imagePath = join(CAPTURE_DIR, `${CHANNEL}-${timestamp}.jpg`);
    try {
      captureFrame(hlsUrl, imagePath);
    } catch (err) {
      log(`Capture failed: ${err.message}`);
      return;
    }

    captureCount++;
    log(`📸 #${captureCount} captured → analyzing with ${model.name}...`);

    // Analyze
    let result;
    try {
      if (model.type === "ollama") {
        result = await analyzeWithOllama(imagePath, model.name);
      } else {
        result = await analyzeWithAnthropic(imagePath, model.name, anthropicKey);
      }
    } catch (err) {
      log(`Analysis failed (${model.name}): ${err.message}`);
      result = { response: `ERROR: ${err.message}`, elapsed_ms: 0 };
    }

    // Log
    const entry = {
      timestamp: new Date(timestamp).toISOString(),
      capture_number: captureCount,
      model: model.name,
      model_type: model.type,
      image: imagePath,
      response: result.response,
      elapsed_ms: result.elapsed_ms,
      tokens: model.type === "ollama"
        ? { eval: result.tokens_eval, prompt: result.tokens_prompt }
        : { input: result.input_tokens, output: result.output_tokens },
    };

    appendFileSync(evalFile, JSON.stringify(entry) + "\n");

    log(`  ${model.name} (${result.elapsed_ms}ms): ${result.response.slice(0, 120)}...`);
  }

  // Initial check
  log("Checking if stream is live...");
  const hlsCheck = await getHlsUrl(CHANNEL);
  if (!hlsCheck) {
    log(`${CHANNEL} is offline. Will poll every ${INTERVAL_MS / 1000}s until live.`);
  } else {
    log(`${CHANNEL} is LIVE! Starting captures.`);
  }

  // Run immediately then on interval
  await tick();
  const interval = setInterval(tick, INTERVAL_MS);

  process.on("SIGINT", () => {
    clearInterval(interval);
    log(`\nDone! ${captureCount} captures saved to ${evalFile}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
