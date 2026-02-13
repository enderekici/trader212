import { type NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const API_SECRET_KEY = process.env.API_SECRET_KEY || '';

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = `${API_URL}/api/${path.join('/')}`;
  const url = new URL(target);

  // Forward query string
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_SECRET_KEY) {
    headers['Authorization'] = `Bearer ${API_SECRET_KEY}`;
  }

  // Forward relevant request headers
  const accept = req.headers.get('accept');
  if (accept) {
    headers['Accept'] = accept;
  }

  const fetchInit: RequestInit = {
    method: req.method,
    headers,
  };

  // Forward body for non-GET methods
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      const body = await req.text();
      if (body) {
        fetchInit.body = body;
      }
    } catch {
      // No body to forward
    }
  }

  try {
    const res = await fetch(url.toString(), fetchInit);
    const responseBody = await res.text();

    return new NextResponse(responseBody, {
      status: res.status,
      statusText: res.statusText,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy request failed';
    return NextResponse.json(
      { error: 'Backend unavailable', details: message },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, context);
}
