import Corestore from 'corestore';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import RAM from 'random-access-memory';

const args = process.argv;

if (!args[2] || !/^[0-9a-f]{64}$/.test(args[2])) {
  console.error('[error] Usage: node bin/reader.js [0-9a-f]{64}');
  process.exit(1);
}

const key = args[2] && args[2].length === 64 ? b4a.from(args[2], 'hex') : null;

if (!key) {
  console.error('[error] Hypercore discovery key is required');
  process.exit(1);
}

console.log('hypercore discovery key:', b4a.toString(key, 'hex'));

const swarm = new Hyperswarm();
const store = new Corestore((filename) => {
  // Filename will be one of: data, bitfield, tree, signatures, key, secret_key
  // The data file will contain all the data concatenated.

  // Store all files in ram by returning a random-access-memory instance
  return new RAM();
});

// Get sync core
const core = store.get({ key, valueEncoding: 'json' });

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

  store.replicate(conn);
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

if (core.length === 0) {
  throw new Error('No data in core');
}

const { keys } = await core.get(0);
for await (const key of keys) {
  console.log('Loading core with discovery key:', key);

  const core = store.get({ key: b4a.from(key, 'hex') });
  // On every append to the hypercore,
  // download the latest block and print it
  core.on('append', () => {
    console.log('new data appended to core');
    const seq = core.length - 1;
    core.get(seq).then((block) => {
      console.log(`Last block (${seq}) in core ${key} is`, block.toString().replace(/\n/g, ''));
    });
  });
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
