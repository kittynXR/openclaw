#!/usr/bin/env node
/**
 * Capture a single frame from a live Twitch stream via HLS.
 * 
 * Usage: node stream-capture.mjs [channel] [output.jpg]
 * 
 * Uses Twitch's GQL API to get the HLS playlist, then ffmpeg to grab one frame.
 * Returns the path to the captured image, or exits with error if offline.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // Public web client ID

async function getPlaybackToken(channel) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Client-ID": TWITCH_CLIENT_ID, "Content-Type": "application/json" },
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
  if (!token) throw new Error("Could not get playback token (channel may be offline)");
  return { token: token.value, sig: token.signature };
}

async function getHlsPlaylist(channel, token, sig) {
  const params = new URLSearchParams({
    allow_source: "true",
    fast_bread: "true",
    p: String(Math.floor(Math.random() * 999999)),
    player_backend: "mediaplayer",
    sig,
    token,
  });
  
  const url = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${params}`;
  const res = await fetch(url);
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HLS playlist fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }
  
  return await res.text();
}

function parseBestQuality(playlist) {
  // Find the highest quality stream URL from the master playlist
  const lines = playlist.split("\n");
  let bestUrl = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Take the first stream URL (usually source/best quality)
    if (line.startsWith("https://")) {
      bestUrl = line;
      break;
    }
  }
  
  return bestUrl;
}

function captureFrame(hlsUrl, outputPath) {
  // Use ffmpeg to grab exactly 1 frame from the HLS stream
  execSync(
    `ffmpeg -y -i "${hlsUrl}" -frames:v 1 -q:v 2 "${outputPath}" 2>/dev/null`,
    { timeout: 15000 }
  );
}

async function capture(channel, outputPath) {
  const { token, sig } = await getPlaybackToken(channel);
  const playlist = await getHlsPlaylist(channel, token, sig);
  const streamUrl = parseBestQuality(playlist);
  
  if (!streamUrl) throw new Error("Could not find stream URL in playlist");
  
  captureFrame(streamUrl, outputPath);
  return outputPath;
}

// CLI
const channel = process.argv[2] || "kittyn";
const captureDir = join(homedir(), ".openclaw", "state", "stream-captures");
if (!existsSync(captureDir)) mkdirSync(captureDir, { recursive: true });
const output = process.argv[3] || join(captureDir, `${channel}-${Date.now()}.jpg`);

try {
  const path = await capture(channel, output);
  console.log(path);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
