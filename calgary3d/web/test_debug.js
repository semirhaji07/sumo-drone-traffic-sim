const http = require('http');
const net = require('net');
const fs = require('fs');

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

class CDP {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.handlers = {};
    this.id = 1;
    this.ready = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const u = new URL(this.url);
      this.socket = net.createConnection({ port: u.port || 80, host: u.hostname });
      const path = u.pathname + u.search;
      const key = Buffer.from(Math.random() + '').toString('base64');
      this.socket.once('connect', () => {
        this.socket.write(`GET ${path} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      
      let headerDone = false;
      this.socket.on('data', (d) => {
        if (!headerDone) {
          const s = d.toString();
          if (s.includes('\r\n\r\n')) {
            headerDone = true;
            this.ready = true;
            const x = s.split('\r\n\r\n');
            if (x[1]) this.buf = Buffer.concat([this.buf, Buffer.from(x[1], 'binary')]);
            console.log('[CDP] Connected');
            resolve();
          }
          return;
        }
        this.buf = Buffer.concat([this.buf, d]);
        this.drain();
      });

      this.socket.on('error', reject);
    });
  }

  drain() {
    while (this.buf.length >= 2) {
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; off = 10; len = this.buf.readUInt32BE(6); }
      if (this.buf.length < off + len) return;
      const msg = this.buf.slice(off, off + len).toString();
      this.buf = this.buf.slice(off + len);
      try {
        const obj = JSON.parse(msg);
        if (obj.id) {
          console.log(`[CDP] Got response id=${obj.id}`);
          if (this.handlers[obj.id]) {
            this.handlers[obj.id](obj);
            delete this.handlers[obj.id];
          }
        }
      } catch (e) { console.log('[CDP] Parse error:', e.message); }
    }
  }

  cmd(method, params = {}) {
    const id = this.id++;
    console.log(`[CDP] Sending ${method} (id=${id})`);
    const frame = Buffer.from(JSON.stringify({ id, method, params }));
    const hdr = Buffer.alloc(2 + frame.length);
    hdr[0] = 0x81; hdr[1] = frame.length;
    frame.copy(hdr, 2);
    this.socket.write(hdr);
    return new Promise(r => { 
      this.handlers[id] = r;
      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.handlers[id]) {
          console.log(`[CDP] Timeout on id=${id}`);
          delete this.handlers[id];
          r({ error: 'timeout' });
        }
      }, 5000);
    });
  }

  close() { this.socket.destroy(); }
}

async function run() {
  // Wait for CDP
  let ok = false;
  for (let i = 0; i < 40; i++) {
    try {
      await new Promise((r, x) => {
        http.get('http://127.0.0.1:9555/json/version', (res) => {
          let b = ''; res.on('data', d => b += d);
          res.on('end', () => res.statusCode === 200 ? r() : x());
        }).on('error', x).setTimeout(1000);
      });
      ok = true; break;
    } catch (e) {
      process.stdout.write('.');
      await delay(500);
    }
  }
  console.log(ok ? '\n[Main] CDP Ready' : '\n[Main] CDP Timeout');
  if (!ok) process.exit(1);

  // Get CDP URL
  const tgts = await new Promise(r => {
    http.get('http://127.0.0.1:9555/json', (res) => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => r(JSON.parse(b)));
    });
  });
  const wsUrl = tgts[0]?.webSocketDebuggerUrl;
  console.log('[Main] Using target:', tgts[0]?.title);

  const cdp = new CDP(wsUrl);
  await cdp.connect();

  // Navigate
  console.log('[Main] Sending navigate...');
  let res = await cdp.cmd('Page.navigate', { url: 'http://localhost:8765/?mockcong=1' });
  console.log('[Main] Navigate response:', res.id ? 'OK' : 'FAIL');

  // Wait for render
  console.log('[Main] Waiting 25s for render...');
  await delay(25000);

  // Screenshot
  console.log('[Main] Taking screenshot 1...');
  res = await cdp.cmd('Page.captureScreenshot', { format: 'png' });
  console.log('[Main] Screenshot response:', res.result ? 'OK' : 'FAIL');
  if (res.result?.data) {
    fs.writeFileSync('screenshot_1_overview.png', Buffer.from(res.result.data, 'base64'));
    console.log('[Main] Saved screenshot_1_overview.png');
  }

  cdp.close();
  console.log('[Main] Done');
  process.exit(0);
}

run().catch(e => { console.error('[Main] Error:', e); process.exit(1); });
