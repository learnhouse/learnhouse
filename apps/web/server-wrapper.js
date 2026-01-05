#!/usr/bin/env node

/**
 * Server wrapper for Next.js standalone mode
 * This script generates a runtime config file from environment variables
 * and injects them before starting the Next.js server.
 */

const fs = require('fs');
const path = require('path');

// Read all NEXT_PUBLIC_* environment variables from the environment
const env = process.env;

// Collect all NEXT_PUBLIC_* variables from the environment
const runtimeConfig = {};

Object.keys(env).forEach((key) => {
  if (key.startsWith('NEXT_PUBLIC_')) {
    runtimeConfig[key] = env[key];
    process.env[key] = env[key];
  }
});

// Write runtime config JSON file
const configPath = path.join(__dirname, 'runtime-config.json');
fs.writeFileSync(configPath, JSON.stringify(runtimeConfig, null, 2), 'utf8');

// Create client-side runtime config script for browser access
// In Next.js standalone, public files are served from the public directory
const publicDir = path.join(__dirname, 'public');
try {
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const scriptPath = path.join(publicDir, 'runtime-config.js');
  fs.writeFileSync(
    scriptPath,
    `window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
    'utf8'
  );
} catch {
  // Ignore if can't create (non-critical for server-side rendering)
  // Client-side config is optional if runtime-config.json is available
}

// Set default HOSTNAME if not provided
if (!process.env.HOSTNAME) {
  process.env.HOSTNAME = '0.0.0.0';
}

// Set PORT from environment or default
if (!process.env.PORT) {
  process.env.PORT = '3000';
}

// Now require and run the actual Next.js server
// The server.js is in the same directory (standalone output)
require('./server.js');

