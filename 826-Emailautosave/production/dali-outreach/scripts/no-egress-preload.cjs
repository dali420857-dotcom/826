'use strict';

const net = require('node:net');

const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const originalFetch = globalThis.fetch;

function assertLoopback(input) {
  const url = input instanceof URL ? input : new URL(String(input));
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`NO_EGRESS_BLOCKED:${url.hostname}`);
  }
}

if (originalFetch) {
  globalThis.fetch = async function guardedFetch(input, init) {
    const target = typeof input === 'string' || input instanceof URL ? input : input.url;
    assertLoopback(target);
    return originalFetch(input, init);
  };
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = args[0];
  const host = typeof first === 'object' && first !== null ? first.host : args[1];
  if (host && !allowedHosts.has(host)) {
    throw new Error(`NO_EGRESS_BLOCKED:${host}`);
  }
  return originalConnect.apply(this, args);
};

globalThis.__DALI_NO_EGRESS__ = Object.freeze({ allowedHosts });

