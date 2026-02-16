import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

/**
 * Returns the WebSocket URL with authentication token.
 * The token is only exposed server-side, never sent to the browser.
 */
export async function GET() {
  const apiSecretKey = process.env.API_SECRET_KEY;

  // Use WS_URL env var if set, otherwise derive from request host
  let wsBaseUrl: string;

  if (process.env.WS_URL) {
    // Explicit WebSocket URL configured
    wsBaseUrl = process.env.WS_URL;
  } else {
    // Derive from request headers
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const proto = headersList.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';

    // For production, assume bot is on port 3001 on same host
    const wsHost = host.replace(':3000', ':3001');
    wsBaseUrl = `${proto}://${wsHost}`;
  }

  if (!apiSecretKey) {
    // No auth configured - return URL without token
    return NextResponse.json({ url: `${wsBaseUrl}/ws` });
  }

  // Return WebSocket URL with token parameter
  return NextResponse.json({ url: `${wsBaseUrl}/ws?token=${apiSecretKey}` });
}
