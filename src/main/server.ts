/**
 * Local presentation server.
 *
 *   GET  /projector  /overlay  /follow   presentation page (one page, three layouts)
 *   GET  /events                         Server-Sent Events: the display view on every change
 *   GET  /api/state                      current display view (JSON)
 *   POST /api/control                    {action: blank|unblank|next|prev, pin?}
 *
 * Binds to 127.0.0.1 by default, so only this computer (projector window,
 * OBS) can see it. LAN mode binds to all interfaces so phones on the
 * gurdwara Wi-Fi can open /follow; control requests from other machines
 * then need the PIN. No external dependencies.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import type { DisplayState, DisplayView } from './display-state';

export type ControlAction = 'blank' | 'unblank' | 'next' | 'prev';

export interface ServerOptions {
  port: number;
  lan: boolean;
  /** Required for control requests from other machines when `lan` is on. */
  pin: string | null;
  /** Directory with present/ and fonts/ subfolders. */
  staticDir: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const CSP = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:";

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** Whether a control request may act (loopback always; LAN only with the PIN). */
export function controlAllowed(remote: string | undefined, opts: Pick<ServerOptions, 'lan' | 'pin'>, pin: string | undefined): boolean {
  if (isLoopback(remote)) return true;
  return opts.lan && !!opts.pin && pin === opts.pin;
}

export class PresentationServer {
  private server: Server | null = null;
  private clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;
  private boundPort = 0;
  private opts: ServerOptions;
  private readonly onChange = (view: DisplayView) => this.broadcast(view);

  constructor(
    private readonly display: DisplayState,
    opts: ServerOptions,
    private readonly onControl: (action: ControlAction) => void,
  ) {
    this.opts = { ...opts };
    display.on('change', this.onChange);
  }

  get port(): number {
    return this.boundPort;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get options(): ServerOptions {
    return { ...this.opts };
  }

  /** URLs for the operator to copy. LAN URLs only when LAN mode is on. */
  urls(): { projector: string; overlay: string; follow: string; lanFollow: string[] } {
    const base = `http://127.0.0.1:${this.boundPort}`;
    const lan: string[] = [];
    if (this.opts.lan) {
      for (const list of Object.values(networkInterfaces())) {
        for (const a of list ?? []) {
          if (a.family === 'IPv4' && !a.internal) lan.push(`http://${a.address}:${this.boundPort}/follow`);
        }
      }
    }
    return { projector: `${base}/projector`, overlay: `${base}/overlay`, follow: `${base}/follow`, lanFollow: lan };
  }

  async start(): Promise<number> {
    const host = this.opts.lan ? '0.0.0.0' : '127.0.0.1';
    for (let port = this.opts.port, tries = 0; tries < 20; port++, tries++) {
      try {
        await this.listen(host, port);
        this.boundPort = (this.server!.address() as AddressInfo).port;
        this.heartbeat = setInterval(() => {
          for (const c of this.clients) c.write(': ping\n\n');
        }, 15000);
        return this.boundPort;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      }
    }
    throw new Error(`no free port from ${this.opts.port}`);
  }

  /** Apply new options (e.g. LAN on/off) by restarting the listener. */
  async reconfigure(opts: Partial<ServerOptions>): Promise<number> {
    const port = this.boundPort || this.opts.port;
    this.opts = { ...this.opts, ...opts, port: opts.port ?? port };
    await this.stop(false);
    return this.start();
  }

  async stop(detach = true): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const c of this.clients) c.end();
    this.clients.clear();
    if (detach) this.display.off('change', this.onChange);
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }

  private listen(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = createServer((req, res) => void this.handle(req, res));
      s.once('error', reject);
      s.listen(port, host, () => {
        s.off('error', reject);
        this.server = s;
        resolve();
      });
    });
  }

  private broadcast(view: DisplayView): void {
    const data = `data: ${JSON.stringify(view)}\n\n`;
    for (const c of this.clients) c.write(data);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/') {
        res.writeHead(302, { Location: '/follow' }).end();
      } else if (req.method === 'GET' && (path === '/projector' || path === '/overlay' || path === '/follow')) {
        await this.file(res, join(this.opts.staticDir, 'present', 'index.html'));
      } else if (req.method === 'GET' && (path.startsWith('/present/') || path.startsWith('/fonts/'))) {
        await this.file(res, join(this.opts.staticDir, path));
      } else if (req.method === 'GET' && path === '/events') {
        this.events(req, res);
      } else if (req.method === 'GET' && path === '/api/state') {
        this.json(res, 200, this.display.view());
      } else if (req.method === 'POST' && path === '/api/control') {
        await this.control(req, res);
      } else {
        this.json(res, 404, { error: 'not found' });
      }
    } catch (e) {
      if (!res.headersSent) this.json(res, 500, { error: String((e as Error).message ?? e) });
    }
  }

  private async file(res: ServerResponse, path: string): Promise<void> {
    const root = normalize(this.opts.staticDir + sep);
    const full = normalize(path);
    if (!full.startsWith(root)) return this.json(res, 403, { error: 'forbidden' });
    const body = await readFile(full).catch(() => null);
    if (!body) return this.json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  private events(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify(this.display.view())}\n\n`);
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  private async control(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 4096) return this.json(res, 413, { error: 'too large' });
      chunks.push(c as Buffer);
    }
    let body: { action?: string; pin?: string } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return this.json(res, 400, { error: 'invalid json' });
    }
    const pin = (req.headers['x-pin'] as string | undefined) ?? body.pin;
    if (!controlAllowed(req.socket.remoteAddress, this.opts, pin)) return this.json(res, 403, { error: 'pin required' });
    const action = body.action as ControlAction;
    if (!['blank', 'unblank', 'next', 'prev'].includes(action)) return this.json(res, 400, { error: 'unknown action' });
    this.onControl(action);
    this.json(res, 200, { ok: true });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
}
