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

// Collect all NEXT_PUBLIC_* variables
const runtimeConfig = {};

// List of all known NEXT_PUBLIC_* variables that might be set
const knownPublicVars = [
  'NEXT_PUBLIC_LEARNHOUSE_API_URL',
  'NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL',
  'NEXT_PUBLIC_LEARNHOUSE_DOMAIN',
  'NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN',
  'NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG',
  'NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG',
  'NEXT_PUBLIC_LEARNHOUSE_HTTPS',
  'NEXT_PUBLIC_LEARNHOUSE_MEDIA_URL',
  'NEXT_PUBLIC_UNSPLASH_ACCESS_KEY',
];

// Collect all NEXT_PUBLIC_* variables
Object.keys(env).forEach((key) => {
  if (key.startsWith('NEXT_PUBLIC_')) {
    runtimeConfig[key] = env[key];
    process.env[key] = env[key];
  }
});

// Ensure known variables are set (with defaults if needed)
knownPublicVars.forEach((key) => {
  if (env[key]) {
    runtimeConfig[key] = env[key];
    process.env[key] = env[key];
  } else if (!runtimeConfig[key]) {
    // Set defaults for required variables
    switch (key) {
      case 'NEXT_PUBLIC_LEARNHOUSE_API_URL':
        runtimeConfig[key] = 'http://localhost/api/v1/';
        break;
      case 'NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL':
        runtimeConfig[key] = 'http://localhost/';
        break;
      case 'NEXT_PUBLIC_LEARNHOUSE_DOMAIN':
        runtimeConfig[key] = 'localhost';
        break;
      case 'NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN':
        runtimeConfig[key] = 'localhost';
        break;
      case 'NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG':
        runtimeConfig[key] = 'false';
        break;
      case 'NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG':
        runtimeConfig[key] = 'default';
        break;
      case 'NEXT_PUBLIC_LEARNHOUSE_HTTPS':
        runtimeConfig[key] = 'false';
        break;
    }
    if (runtimeConfig[key]) {
      process.env[key] = runtimeConfig[key];
    }
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

