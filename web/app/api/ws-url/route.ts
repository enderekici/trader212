import { NextResponse } from 'next/server';

/**
 * Returns the WebSocket URL with authentication token.
 * The token is only exposed server-side, never sent to the browser.
 */
export async function GET() {
  const apiSecretKey = process.env.API_SECRET_KEY;

  if (!apiSecretKey) {
    // No auth configured - return URL without token
    const apiUrl = process.env.API_URL || 'http://bot:3001';
    const wsUrl = apiUrl.replace(/^http/, 'ws');
    return NextResponse.json({ url: `${wsUrl}/ws` });
  }

  // Return WebSocket URL with token parameter
  const apiUrl = process.env.API_URL || 'http://bot:3001';
  const wsUrl = apiUrl.replace(/^http/, 'ws');
  return NextResponse.json({ url: `${wsUrl}/ws?token=${apiSecretKey}` });
}
