import Hyperswarm from 'hyperswarm';
import HyperCore from 'hypercore';
import b4a from 'b4a';
import RAM from 'random-access-memory';

const args = process.argv;

if (!args[2] || !/^[0-9a-f]{64}$/.test(args[2])) {
  console.error('[error] Usage: node bin/reader.js [0-9a-f]{64}');
  process.exit(1);
}

const discoveryKey = args[2] && args[2].length === 64 ? b4a.from(args[2], 'hex') : null;

if (!discoveryKey) {
  console.error('[error] Hypercore discovery key is required');
  process.exit(1);
}

console.log('hypercore discovery key:', b4a.toString(discoveryKey, 'hex'));

const swarm = new Hyperswarm();
const core = new HyperCore((filename) => {
  // Filename will be one of: data, bitfield, tree, signatures, key, secret_key
  // The data file will contain all the data concatenated.

  // Store all files in ram by returning a random-access-memory instance
  return new RAM();
}, discoveryKey);

core.on('ready', () => console.log('Core ready'));
core.on('close', () => console.log('Core close'));
core.on('append', () => console.log('Core append'));
core.on('peer-add', () => console.log('Core peer-add'));
core.on('peer-remove', () => console.log('Core peer-remove'));
core.on('truncate', (ancestors, forkId) => console.log('Core truncate', ancestors, forkId));

await core.ready();

console.log('hypercore discovery key:', b4a.toString(core.discoveryKey, 'hex'));
console.log('hypercore key:', b4a.toString(core.key, 'hex'));

// https://docs.pears.com/building-blocks/hypercore#core.findingpeers
const foundPeers = core.findingPeers();
swarm.join(core.discoveryKey);
swarm.on('error', (err) => console.error('Swarm error:', err));
swarm.on('ready', () => console.log('Swarm ready'));
swarm.on('connection', (conn) => {
  console.log('new peer connected');

  core.replicate(conn);
});

// Swarm.flush() will wait until *all* discoverable peers have been connected to
// It might take a while, so don't await it
// Instead, use core.findingPeers() to mark when the discovery process is done
swarm.flush().then(() => {
  console.log('Swarm flushed');

  foundPeers();
});

// https://docs.pears.com/building-blocks/hypercore#core.update
// This won't resolve until either
// - The first peer is found
// - No peers could be found
const updated = await core.update();
console.log('core was updated?', updated, 'length is', core.length);

let position = 0;
console.log('Reading from position:', position);
for await (const block of core.createReadStream({ start: position, live: true })) {
  console.log(`Block ${position}:`, block.toString().replace(/\n$/, ''));
  position++;
}

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
