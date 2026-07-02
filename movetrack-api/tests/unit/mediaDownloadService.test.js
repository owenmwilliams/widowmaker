/**
 * Unit tests for services/infra/mediaDownloadService.js (Pathway A — deterministic
 * media transport, issue #40). Covers the acceptance criteria: non-2xx response,
 * truncated body vs Content-Length, timeout, retry-then-succeed. Spins up a real
 * local HTTP server per test so the download path (status/timeout/retry/length
 * checks) runs unmocked; retries use an injected no-op sleep so they run instantly.
 */

const http = require('http');
const { downloadBuffer, MediaDownloadError, parseGcsUrl, assertAllowedGcsPath } = require('../../services/infra/mediaDownloadService');
const gcs = require('../../services/infra/gcsService');

const noSleep = () => Promise.resolve();

/**
 * Start a server whose handler is provided per-test; returns { url, close, requestCount }.
 * Tracks live sockets and force-destroys them on close so an abandoned/hung
 * connection (e.g. from a timeout test) can never block server.close().
 */
function startServer(handler) {
  return new Promise((resolve) => {
    let requestCount = 0;
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      requestCount++;
      handler(req, res, requestCount);
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/file`,
        close: () => new Promise((r) => {
          for (const socket of sockets) socket.destroy();
          server.close(r);
        }),
        getRequestCount: () => requestCount,
      });
    });
  });
}

describe('downloadBuffer', () => {
  test('resolves with the full body on a normal 200 response', async () => {
    const body = Buffer.from('hello world');
    const { url, close } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    });
    try {
      const result = await downloadBuffer(url, { retries: 0, sleepFn: noSleep });
      expect(result.equals(body)).toBe(true);
    } finally {
      await close();
    }
  });

  test('non-2xx response throws instead of returning the error body', async () => {
    const { url, close, getRequestCount } = await startServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/xml' });
      res.end('<Error>NoSuchKey</Error>');
    });
    try {
      await expect(downloadBuffer(url, { retries: 2, sleepFn: noSleep }))
        .rejects.toThrow(/HTTP 404/);
      // 404 is a permanent client error — must not be retried.
      expect(getRequestCount()).toBe(1);
    } finally {
      await close();
    }
  });

  test('a 5xx response is retried then can succeed', async () => {
    const body = Buffer.from('recovered bytes');
    const { url, close, getRequestCount } = await startServer((req, res, count) => {
      if (count < 3) {
        res.writeHead(503);
        res.end('temporarily unavailable');
        return;
      }
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    });
    try {
      const result = await downloadBuffer(url, { retries: 3, sleepFn: noSleep });
      expect(result.equals(body)).toBe(true);
      expect(getRequestCount()).toBe(3);
    } finally {
      await close();
    }
  });

  test('a body cut off mid-transfer (short of Content-Length) is never returned as success', async () => {
    // A clean HTTP response can't end() with fewer bytes than its declared
    // Content-Length — Node's client-side parser treats that as a connection
    // reset (this is what a real dropped GCS download looks like), so we
    // force that here rather than a synthetic clean 'end'. Either way, the
    // acceptance bar is the same: downloadBuffer must never resolve with the
    // partial bytes it did receive.
    const { url, close, getRequestCount } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': '1000' });
      res.write('only a few bytes'); // far short of the declared Content-Length
      res.socket.destroy(); // simulate the connection dropping mid-download
    });
    try {
      await expect(downloadBuffer(url, { retries: 2, sleepFn: noSleep }))
        .rejects.toThrow();
      // A reset mid-transfer is transient — every attempt fails the same way
      // here, so it exhausts retries: initial + 2 retries = 3 tries.
      expect(getRequestCount()).toBe(3);
    } finally {
      await close();
    }
  });

  test('a hung response times out', async () => {
    const { url, close } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': '10' });
      // Never write the body — simulates the scan pipeline going silent mid-download.
    });
    try {
      await expect(downloadBuffer(url, { retries: 0, timeoutMs: 50, sleepFn: noSleep }))
        .rejects.toThrow(/timed out/);
    } finally {
      await close();
    }
  });

  test('expectedBytes mismatch throws and is NOT retried (upload was incomplete, not a transport blip)', async () => {
    const body = Buffer.from('short body');
    const { url, close, getRequestCount } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    });
    try {
      await expect(downloadBuffer(url, { retries: 3, sleepFn: noSleep, expectedBytes: body.length + 500 }))
        .rejects.toThrow(/client reported/);
      expect(getRequestCount()).toBe(1);
    } finally {
      await close();
    }
  });

  test('expectedBytes matching the download succeeds', async () => {
    const body = Buffer.from('exactly this many bytes');
    const { url, close } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    });
    try {
      const result = await downloadBuffer(url, { retries: 0, sleepFn: noSleep, expectedBytes: body.length });
      expect(result.equals(body)).toBe(true);
    } finally {
      await close();
    }
  });
});

describe('MediaDownloadError', () => {
  test('carries status/code when provided', () => {
    const err = new MediaDownloadError('boom', { status: 502, code: 'ETRUNCATED' });
    expect(err.name).toBe('MediaDownloadError');
    expect(err.status).toBe(502);
    expect(err.code).toBe('ETRUNCATED');
  });
});

describe('downloadBuffer timeout is inactivity-based, not a flat cap (arbiter major #3)', () => {
  test('a slow-but-steady transfer succeeds even past the timeout duration in total', async () => {
    const parts = ['aaa', 'bbb', 'ccc', 'ddd'];
    const { url, close } = await startServer((req, res) => {
      res.writeHead(200);
      let i = 0;
      const interval = setInterval(() => {
        if (i >= parts.length) { clearInterval(interval); res.end(); return; }
        res.write(parts[i++]);
      }, 25); // each gap well under timeoutMs below, but total (~100ms) exceeds it
    });
    try {
      const result = await downloadBuffer(url, { retries: 0, timeoutMs: 60, sleepFn: noSleep });
      expect(result.toString()).toBe(parts.join(''));
    } finally {
      await close();
    }
  });

  test('a stall mid-transfer (after some bytes already arrived) still times out', async () => {
    const { url, close } = await startServer((req, res) => {
      res.writeHead(200);
      res.write('first chunk only, then silence');
      // never res.end() — simulates the pipeline going quiet mid-download
    });
    try {
      await expect(downloadBuffer(url, { retries: 0, timeoutMs: 50, sleepFn: noSleep }))
        .rejects.toThrow(/timed out/);
    } finally {
      await close();
    }
  });
});

describe('GCS path restriction to the app bucket + calling user prefix (arbiter major #4)', () => {
  test('parseGcsUrl handles path-style, gs://, and virtual-hosted URLs identically', () => {
    expect(parseGcsUrl('https://storage.googleapis.com/my-bucket/users/u1/x.jpg'))
      .toEqual({ bucket: 'my-bucket', path: 'users/u1/x.jpg' });
    expect(parseGcsUrl('gs://my-bucket/users/u1/x.jpg'))
      .toEqual({ bucket: 'my-bucket', path: 'users/u1/x.jpg' });
    expect(parseGcsUrl('https://my-bucket.storage.googleapis.com/users/u1/x.jpg'))
      .toEqual({ bucket: 'my-bucket', path: 'users/u1/x.jpg' });
  });

  test('percent-decodes the path so an encoded segment cannot hide from the prefix check', () => {
    const { path } = parseGcsUrl('https://storage.googleapis.com/my-bucket/users/u1/na%20me.jpg');
    expect(path).toBe('users/u1/na me.jpg');
  });

  test('rejects a bucket other than the app bucket', () => {
    expect(() => assertAllowedGcsPath('some-other-bucket', 'users/u1/x.jpg', 'u1'))
      .toThrow(/untrusted bucket/);
  });

  test('rejects a path outside the calling user\'s own prefix', () => {
    expect(() => assertAllowedGcsPath(gcs.BUCKET, 'users/someone-else/x.jpg', 'u1'))
      .toThrow(/outside the calling user/);
  });

  test('allows the calling user\'s own prefix in the app bucket', () => {
    expect(() => assertAllowedGcsPath(gcs.BUCKET, 'users/u1/x.jpg', 'u1')).not.toThrow();
  });

  test('downloadBuffer refuses a gs:// URL for a different user before touching the network', async () => {
    await expect(downloadBuffer('gs://movetrack-item-photos/users/attacker-target/secret.jpg', { userId: 'u1', retries: 0 }))
      .rejects.toThrow(/outside the calling user/);
  });

  test('downloadBuffer refuses a URL pointed at a foreign bucket even with a valid-looking prefix', async () => {
    await expect(downloadBuffer('gs://some-other-bucket/users/u1/x.jpg', { userId: 'u1', retries: 0 }))
      .rejects.toThrow(/untrusted bucket/);
  });
});
