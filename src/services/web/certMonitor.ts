import { connect, type PeerCertificate } from 'node:tls';

/**
 * TLS certificate inspector.
 *
 * Certificates expiring unnoticed are one of the classic ways a healthy-looking
 * site goes dark, so the monitor treats "days until expiry" as a first-class
 * health signal alongside HTTP status.
 *
 * The handshake runs with `rejectUnauthorized: false` on purpose: an already
 * expired or otherwise untrusted certificate is exactly the case worth
 * reporting, and rejecting it would leave us with no detail to report. The
 * validation result is surfaced explicitly in `authorized` / `authError`.
 */

export interface CertInfo {
  host: string;
  validFrom: Date;
  validTo: Date;
  daysRemaining: number;
  issuer: string;
  /** Whether Node's default trust store accepted the chain. */
  authorized: boolean;
  authError: string | null;
}

export interface CertResult {
  info: CertInfo | null;
  error: string | null;
}

const MS_PER_DAY = 86_400_000;

/** Inspect the certificate presented by an https URL. */
export async function checkCertificate(url: string, timeoutMs = 8000): Promise<CertResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { info: null, error: `Invalid URL "${url}".` };
  }
  if (target.protocol !== 'https:') {
    return { info: null, error: 'Not an https URL.' };
  }

  const host = target.hostname;
  const port = Number(target.port) || 443;

  return new Promise<CertResult>((resolvePromise) => {
    let settled = false;
    const finish = (result: CertResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(result);
    };

    const socket = connect(
      {
        host,
        port,
        servername: host, // SNI — required for virtual-hosted TLS
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0) {
          finish({ info: null, error: 'Server presented no certificate.' });
          return;
        }

        const authError = socket.authorizationError;
        finish({
          info: toCertInfo(host, cert, socket.authorized, authError),
          error: null,
        });
      },
    );

    socket.on('timeout', () => {
      finish({ info: null, error: `TLS handshake timed out after ${timeoutMs}ms.` });
    });
    socket.on('error', (error: Error) => {
      finish({ info: null, error: error.message });
    });
  });
}

function firstValue(field: string | string[] | undefined): string | null {
  if (Array.isArray(field)) return field[0] ?? null;
  return field ?? null;
}

function toCertInfo(
  host: string,
  cert: PeerCertificate,
  authorized: boolean,
  authError: Error | undefined,
): CertInfo {
  const validTo = new Date(cert.valid_to);
  const validFrom = new Date(cert.valid_from);
  const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / MS_PER_DAY);

  return {
    host,
    validFrom,
    validTo,
    daysRemaining,
    // Distinguished-name fields may repeat, in which case Node yields an array.
    issuer: firstValue(cert.issuer?.O) ?? firstValue(cert.issuer?.CN) ?? 'unknown issuer',
    authorized,
    authError: authError ? authError.message : null,
  };
}
