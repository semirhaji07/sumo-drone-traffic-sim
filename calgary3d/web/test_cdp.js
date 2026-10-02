const http = require('http');
const net = require('net');
const fs = require('fs');

class SimpleWSClient {
  constructor(wsUrl) {
    this.url = new URL(wsUrl);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handlers = {};
    this.msgId = 1;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port: this.url.port || 80, host: this.url.hostname }, () => {
        const path = this.url.pathname + this.url.search;
        const key = Buffer.from(Math.random().toString()).toString('base64');
        const req = `GET ${path} HTTP/1.1\r\nHost: ${this.url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
        this.socket.write(req);
      });

      this.socket.on('data', (chunk) => {
        if (!this.connected) {
          if (chunk.toString().includes('\r\n\r\n')) {
            this.connected = true;
            const parts = chunk.toString().split('\r\n\r\n');
            if (parts[1]) this.buffer = Buffer.concat([this.buffer, Buffer.from(parts[1], 'binary')]);
            resolve();
          }
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processMessages();
      });

      this.socket.on('error', reject);
      this.socket.on('close', () => {});
    });
  }

  processMessages() {
    while (this.buffer.length >= 2) {
      let len = this.buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        offset = 10;
        len = this.buffer.readUInt32BE(6);
      }
      if (this.buffer.length < offset + len) return;
      const msg = this.buffer.slice(offset, offset + len);
      this.buffer = this.buffer.slice(offset + len);
      try {
        const obj = JSON.parse(msg.toString());
        if (obj.id && this.handlers[obj.id]) {
          this.handlers[obj.id](obj);
          delete this.handlers[obj.id];
        }
      } catch (e) {}
    }
  }

  send(obj) {
    const payload = Buffer.from(JSON.stringify(obj));
    const frame = Buffer.alloc(2 + payload.length);
    frame[0] = 0x81;
    frame[1] = payload.length;
    payload.copy(frame, 2);
    this.socket.write(frame);
  }

  call(method, params = {}) {
    return new Promise((resolve) => {
      const id = this.msgId++;
      this.handlers[id] = resolve;
      this.send({ id, method, params });
    });
  }
}

async function main() {
  console.log('Starting test...');

  // Wait for CDP
  let cdpReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9555/json/version', (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => resolve());
        }).on('error', reject).setTimeout(2000);
      });
      cdpReady = true;
      break;
    } catch (e) {
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!cdpReady) {
    console.error('CDP not ready');
    process.exit(1);
  }

  console.log('\nCDP ready');

  // Get target
  const targets = await new Promise((resolve) => {
    http.get('http://127.0.0.1:9555/json', (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    });
  });

  let wsUrl = targets[0]?.webSocketDebuggerUrl;
  if (!wsUrl) {
    const newTab = await new Promise((resolve) => {
      http.get('http://127.0.0.1:9555/json/new', (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve(JSON.parse(body)));
      });
    });
    wsUrl = newTab.webSocketDebuggerUrl;
  }

  const client = new SimpleWSClient(wsUrl);
  await client.connect();
  console.log('Connected');

  // Navigate
  console.log('Navigating...');
  client.send({ id: client.msgId++, method: 'Page.navigate', params: { url: 'http://localhost:8765/?mockcong=1' } });

  // Wait for load
  console.log('Waiting for page to load (25s)...');
  await new Promise(r => setTimeout(r, 25000));

  // Screenshot 1
  console.log('Screenshot 1...');
  let res = await client.call('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) {
    fs.writeFileSync('C:/Users/15874/Documents/TrafficTests/calgary3d/web/screenshot_1_overview.png', Buffer.from(res.result.data, 'base64'));
    console.log('  Saved');
  }

  await new Promise(r => setTimeout(r, 500));

  // Enable congestion
  console.log('Enabling congestion...');
  res = await client.call('Runtime.evaluate', { expression: `
    document.querySelector('#chk-congestion').checked = true;
    document.querySelector('#chk-congestion').dispatchEvent(new Event('change'));
    true;
  ` });

  await new Promise(r => setTimeout(r, 2000));

  // Screenshot 2
  console.log('Screenshot 2...');
  res = await client.call('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) {
    fs.writeFileSync('C:/Users/15874/Documents/TrafficTests/calgary3d/web/screenshot_2_congestion.png', Buffer.from(res.result.data, 'base64'));
    console.log('  Saved');
  }

  await new Promise(r => setTimeout(r, 500));

  // Position camera
  console.log('Positioning camera...');
  await client.call('Runtime.evaluate', { expression: `
    if (window.__dbg?.camera && window.__dbg.CEN) {
      const x = 1375.9 - window.__dbg.CEN.x;
      const y = -(824.4 - window.__dbg.CEN.y);
      window.__dbg.camera.position.set(x + 80, 150, y + 80);
      window.__dbg.camera.lookAt(x, 40, y);
    }
  ` });

  await new Promise(r => setTimeout(r, 1500));

  // Screenshot 3
  console.log('Screenshot 3...');
  res = await client.call('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) {
    fs.writeFileSync('C:/Users/15874/Documents/TrafficTests/calgary3d/web/screenshot_3_incident.png', Buffer.from(res.result.data, 'base64'));
    console.log('  Saved');
  }

  await new Promise(r => setTimeout(r, 500));

  // Open sources
  console.log('Opening sources...');
  await client.call('Runtime.evaluate', { expression: `document.querySelector('#btn-sources').click()` });

  await new Promise(r => setTimeout(r, 1500));

  // Screenshot 4
  console.log('Screenshot 4...');
  res = await client.call('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) {
    fs.writeFileSync('C:/Users/15874/Documents/TrafficTests/calgary3d/web/screenshot_4_sources.png', Buffer.from(res.result.data, 'base64'));
    console.log('  Saved');
  }

  console.log('\nDone!');
  client.socket.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
