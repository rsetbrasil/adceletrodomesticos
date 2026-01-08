import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function splitMessage(message: string, maxLen: number) {
  const normalized = message.replace(/\r\n/g, '\n');
  if (normalized.length <= maxLen) return [normalized];

  const lines = normalized.split('\n');
  const parts: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) parts.push(current.trimEnd());
    current = '';
  };

  for (const line of lines) {
    const chunk = line;
    if (!chunk) {
      if (current.length + 1 > maxLen) flush();
      current = current ? `${current}\n` : '\n';
      continue;
    }

    if (chunk.length > maxLen) {
      flush();
      for (let i = 0; i < chunk.length; i += maxLen) {
        parts.push(chunk.slice(i, i + maxLen));
      }
      continue;
    }

    const candidate = current ? `${current}\n${chunk}` : chunk;
    if (candidate.length > maxLen) {
      flush();
      current = chunk;
    } else {
      current = candidate;
    }
  }

  flush();
  return parts.length > 0 ? parts : [normalized.slice(0, maxLen)];
}

export async function POST(request: NextRequest) {
  const appkey = process.env.MENUIA_APPKEY;
  const authkey = process.env.MENUIA_AUTHKEY;
  const endpoint = process.env.MENUIA_TEXT_ENDPOINT;

  if (!appkey || !authkey || !endpoint) {
    return NextResponse.json(
      { error: 'Menuia não configurado no servidor.' },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const to = typeof (body as any)?.to === 'string' ? (body as any).to.trim() : '';
  const message = typeof (body as any)?.message === 'string' ? (body as any).message : '';

  if (!to || !message) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: to, message.' },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const parts = splitMessage(message, 900);
    const results: Array<{ ok: boolean; status: number; payload: unknown }> = [];

    for (const part of parts) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appkey, authkey, to, message: part }),
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await res.json().catch(() => null)
        : await res.text().catch(() => null);

      results.push({ ok: res.ok, status: res.status, payload });
      if (!res.ok) {
        return NextResponse.json(
          { error: 'Falha ao enviar mensagem no Menuia.', status: res.status, details: payload, partial: results },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ status: 200, parts: results.length });
  } catch {
    return NextResponse.json(
      { error: 'Falha ao enviar mensagem no Menuia.' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
