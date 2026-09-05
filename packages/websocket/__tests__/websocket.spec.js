const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Websocket = require('../index');

const fakeHenri = () => ({
  config: { get: jest.fn(), has: jest.fn(() => false) },
  pen: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
});

describe('websocket', () => {
  test('requires a henri instance', () => {
    expect(() => new Websocket()).toThrow(/henri instance is required/);
  });

  test('is loadable without a global henri', () => {
    const ws = new Websocket(fakeHenri());

    expect(ws.active).toBe(false);
    expect(ws.io).toBeNull();
  });

  test('init throws without an http server', () => {
    const ws = new Websocket(fakeHenri());

    expect(() => ws.init()).toThrow(/no http server/);
  });

  test('loads handler files and hands them the socket', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-ws-'));

    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(
      path.join(dir, 'chat.js'),
      'module.exports = (socket) => { socket.calls.push("chat"); };'
    );
    fs.writeFileSync(
      path.join(dir, 'nested', 'rooms.js'),
      'module.exports = (socket) => { socket.calls.push("rooms"); };'
    );
    fs.writeFileSync(path.join(dir, 'broken.js'), 'module.exports = ((;');

    const ws = new Websocket(fakeHenri());

    ws.socket = { calls: [] };

    const loaded = await ws.load(dir);

    expect(loaded).toHaveLength(2);
    expect(ws.failed).toHaveLength(1);
    expect(ws.socket.calls.sort()).toEqual(['chat', 'rooms']);

    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('returns an empty list for a missing directory', async () => {
    const ws = new Websocket(fakeHenri());

    expect(await ws.load(path.join(os.tmpdir(), 'does-not-exist'))).toEqual([]);
  });

  test('attaches to an http server and stops cleanly', async () => {
    const server = http.createServer();
    const ws = new Websocket(fakeHenri(), server);

    const io = ws.init();

    expect(io).toBeDefined();
    expect(ws.active).toBe(true);

    await ws.stop();

    expect(ws.active).toBe(false);
    expect(ws.io).toBeNull();
  });
});
