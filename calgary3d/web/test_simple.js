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
    return new Promise((resolve) => {
      const u = new URL(this.url);
      this.socket = net.createConnection({ port: u.port || 80, host: u.hostname });
      const path = u.pathname + u.search;
      const key = Buffer.from(Math.random() + '').toString('base64');
      this.socket.once('connect', () => {
        this.socket.write(`GET ${path} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      this.socket.on('data', (d) => {
        if (!this.ready) {
          if (d.toString().includes('\r\n\r\n')) {
            this.ready = true;
            const x = d.toString().split('\r\n\r\n');
            if (x[1]) this.buf = Buffer.concat([this.buf, Buffer.from(x[1], 'binary')]);
            resolve();
          }
          return;
        }
        this.buf = Buffer.concat([this.buf, d]);
        this.drain();
      });
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
        if (obj.id && this.handlers[obj.id]) this.handlers[obj.id](obj);
      } catch (e) {}
    }
  }

  cmd(method, params = {}) {
    const id = this.id++;
    const frame = Buffer.from(JSON.stringify({ id, method, params }));
    const hdr = Buffer.alloc(2 + frame.length);
    hdr[0] = 0x81; hdr[1] = frame.length;
    frame.copy(hdr, 2);
    this.socket.write(hdr);
    return new Promise(r => { this.handlers[id] = r; });
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
  console.log(ok ? '\nReady' : '\nTimeout');
  if (!ok) process.exit(1);

  // Get CDP URL
  const tgts = await new Promise(r => {
    http.get('http://127.0.0.1:9555/json', (res) => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => r(JSON.parse(b)));
    });
  });
  const wsUrl = tgts[0]?.webSocketDebuggerUrl || (await new Promise(r => {
    http.get('http://127.0.0.1:9555/json/new', (res) => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => r(JSON.parse(b).webSocketDebuggerUrl));
    });
  }));

  const cdp = new CDP(wsUrl);
  await cdp.connect();
  console.log('Connected');

  // Navigate
  cdp.cmd('Page.navigate', { url: 'http://localhost:8765/?mockcong=1' });
  console.log('Navigating...');

  // Wait
  await delay(28000);
  console.log('Taking screenshots...');

  // Screen 1
  let res = await cdp.cmd('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) fs.writeFileSync('screenshot_1_overview.png', Buffer.from(res.result.data, 'base64'));
  console.log('1. overview');

  // Enable congestion
  await cdp.cmd('Runtime.evaluate', { expression: `
    const c = document.querySelector('#chk-congestion');
    if (c) { c.checked = true; c.dispatchEvent(new Event('change')); }
  ` });
  await delay(2000);

  // Screen 2
  res = await cdp.cmd('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) fs.writeFileSync('screenshot_2_congestion.png', Buffer.from(res.result.data, 'base64'));
  console.log('2. congestion');

  // Move camera
  await cdp.cmd('Runtime.evaluate', { expression: `
    if (window.__dbg?.camera && window.__dbg.CEN) {
      const x = 1375.9 - window.__dbg.CEN.x;
      const y = -(824.4 - window.__dbg.CEN.y);
      window.__dbg.camera.position.set(x + 80, 150, y + 80);
      window.__dbg.camera.lookAt(x, 40, y);
    }
  ` });
  await delay(1500);

  // Screen 3
  res = await cdp.cmd('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) fs.writeFileSync('screenshot_3_incident.png', Buffer.from(res.result.data, 'base64'));
  console.log('3. incident');

  // Open panel
  await cdp.cmd('Runtime.evaluate', { expression: `document.querySelector('#btn-sources')?.click()` });
  await delay(1500);

  // Screen 4
  res = await cdp.cmd('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) fs.writeFileSync('screenshot_4_sources.png', Buffer.from(res.result.data, 'base64'));
  console.log('4. sources');

  cdp.close();
  console.log('Done');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
