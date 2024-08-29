import Corestore from 'corestore';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';

const swarm = new Hyperswarm();
const store = new Corestore('/tmp/corestore-writer');

const core1 = store.get({ name: 'core-1', valueEncoding: 'json' });
const core2 = store.get({ name: 'core-2' });
const core3 = store.get({ name: 'core-3' });
await Promise.all([core1.ready(), core2.ready(), core3.ready()]);

console.log('main discovery key:', b4a.toString(core1.discoveryKey, 'hex'));
console.log('main key:', b4a.toString(core1.key, 'hex'));

// Here we'll only join the swarm with core1's discovery key
// We don't need to announce core2 or core3 because they'll be replicated with core1
swarm.join(core1.discoveryKey);

swarm.on('error', (err) => console.error('Swarm error:', err));
swarm.on('ready', () => console.log('Swarm ready'));
swarm.on('connection', (conn) => {
  console.log('new peer connected');

  store.replicate(conn);
});

// Since Corestore does not exchange discovery keys, they need to be manually shared
// We will record the discovery keys of core2 and core3 in the first block of core1
if (!core1.length) {
  core1.append({
    keys: [
      b4a.toString(core2.key, 'hex'), //
      b4a.toString(core3.key, 'hex')
    ]
  });
}

process.stdin.on('data', (data) => {
  if (data.length < 2) {
    return;
  }

  if (data.length < 5) {
    console.log('append short data to core 2');
    core2.append(data);
  } else {
    console.log('append long data to core 3');
    core3.append(data);
  }
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
    store.close();
    swarm.destroy();
  } else {
    process.exit(0);
  }
}
