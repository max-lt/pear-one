import Hyperswarm from 'hyperswarm';
import HyperCore from 'hypercore';
import b4a from 'b4a';
// import crypto from 'hypercore-crypto'; // Cryptographic functions for generating the key in app
// import Corestore from 'corestore';
import RAM from 'random-access-memory';
// import Hyperdrive from 'hyperdrive';
import readline from 'node:readline/promises';
import tty from 'node:tty';

const swarm = new Hyperswarm();
const core = new HyperCore((filename) => {
  // Filename will be one of: data, bitfield, tree, signatures, key, secret_key
  // The data file will contain all the data concatenated.

  // Store all files in ram by returning a random-access-memory instance
  return new RAM();
});

core.on('ready', () => console.log('Core ready'));
core.on('close', () => console.log('Core close'));
core.on('append', () => console.log('Core append'));
core.on('peer-add', () => console.log('Core peer-add'));
core.on('peer-remove', () => console.log('Core peer-remove'));
core.on('truncate', (ancestors, forkId) => console.log('Core truncate', ancestors, forkId));

await core.ready();

console.log('hypercore discovery key:', b4a.toString(core.discoveryKey, 'hex'));
console.log('hypercore key:', b4a.toString(core.key, 'hex'));

// Append all data as separate blocks to the core
process.stdin.on('data', (data) => core.append(data));

swarm.join(core.discoveryKey);
swarm.on('error', (err) => console.error('Swarm error:', err));
swarm.on('ready', () => console.log('Swarm ready'));
swarm.on('connection', (conn) => {
  console.log('new peer connected');

  core.replicate(conn);
});

// Teardown
let stopping = false;
process.on('SIGINT', teardown);
process.on('SIGTERM', teardown);
function teardown() {
  console.log('Teardown');
  if (!stopping) {
    console.log('Gracefully shutting down, press Ctrl+C again to force');
    stopping = true;
    swarm.destroy();
  } else {
    process.exit(0);
  }
}
