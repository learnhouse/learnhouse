export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Node.js specific instrumentation
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime specific instrumentation
  }
}
