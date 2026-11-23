import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export const BUFFER_COOKIE_NAME = 'autobuffer_buffer_key';
export const GEMINI_COOKIE_NAME = 'autobuffer_gemini_key';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase();
  return req.secure || proto.includes('https');
}

function buildCookieHeader(
  name: string,
  value: string,
  req: Request,
  maxAgeSeconds: number
): string {
  const encoded = encodeURIComponent(value);
  const parts = [`${name}=${encoded}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAgeSeconds}`];

  if (isHttpsRequest(req)) {
    // Support embedded iframe previews and same-origin HTTPS requests safely
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

export function setKeyCookie(req: Request, res: Response, name: string, value: string) {
  const headerVal = buildCookieHeader(name, value, req, Math.floor(THIRTY_DAYS_MS / 1000));
  res.append('Set-Cookie', headerVal);
}

export function clearKeyCookie(req: Request, res: Response, name: string) {
  const headerVal = buildCookieHeader(name, '', req, 0);
  res.append('Set-Cookie', headerVal);
}

export function getBufferKeyFromReq(req: Request): string {
  const cookies = parseCookies(req);
  let val = (cookies[BUFFER_COOKIE_NAME] || '').trim();
  if (val.toLowerCase().startsWith('bearer ')) {
    val = val.slice(7).trim();
  }
  return val;
}

export function getGeminiKeyFromReq(req: Request): string {
  const cookies = parseCookies(req);
  return (cookies[GEMINI_COOKIE_NAME] || '').trim();
}

export function hashCredential(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

export function redactSecrets(input: string, secrets: Array<string | undefined | null>): string {
  let output = input || '';
  for (const s of secrets) {
    if (s && s.length >= 6) {
      output = output.split(s).join('[REDACTED]');
    }
  }
  return output;
}

/**
 * CSRF & Origin protection for state-changing cookie-authenticated API routes.
 */
export function verifySameOriginCsrf(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const originHeader = req.headers.origin;
  const requestedWith = req.headers['x-requested-with'];

  if (originHeader) {
    try {
      const originHost = new URL(originHeader).host.toLowerCase();
      if (expectedHost && originHost !== expectedHost) {
        return res.status(403).json({
          success: false,
          error: 'Cross-origin request rejected.',
        });
      }
    } catch {
      return res.status(403).json({
        success: false,
        error: 'Invalid request origin.',
      });
    }
  } else if (requestedWith !== 'AutoBuffer') {
    // Allow standard multipart or JSON calls only if same-origin Origin header or custom header is present
    const referer = req.headers.referer;
    if (referer && expectedHost) {
      try {
        const refHost = new URL(referer).host.toLowerCase();
        if (refHost !== expectedHost) {
          return res.status(403).json({ success: false, error: 'Cross-origin referer rejected.' });
        }
      } catch {
        return res.status(403).json({ success: false, error: 'Invalid referer header.' });
      }
    }
  }

  return next();
}
