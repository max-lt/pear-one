/* global Pear */
import Hyperswarm from 'hyperswarm'; // Module for P2P networking and connecting peers
import b4a from 'b4a'; // Module for buffer-to-string and vice-versa conversions
import crypto from 'hypercore-crypto'; // Cryptographic functions for generating the key in app
import readline from 'node:readline/promises';
import Corestore from 'corestore';
import RAM from 'random-access-memory';
import Hyperdrive from 'hyperdrive';
import tty from 'node:tty';
import process from 'node:process';

const swarm1 = new Hyperswarm();
const swarm2 = new Hyperswarm();

const store1 = new Corestore(RAM);
const store2 = new Corestore(RAM);

await store1.ready();
await store2.ready();
console.log(`Stores ready`);

console.log(`Init drive 1`);
const drive1 = new Hyperdrive(store1);
await drive1.ready();
// teardown(() => drive1.close());
console.log(`Drive 1 ready`);

console.log(`Init drive 2`, drive1.key.toString('hex'));
const drive2 = new Hyperdrive(store2, drive1.key);
await drive2.ready();
// teardown(() => drive2.close());
console.log(`Drive 2 ready`);

// Swarm 1
swarm1.join(drive1.discoveryKey, { server: true, client: false });
swarm1.on('connection', (conn) => drive1.replicate(conn));
await swarm1.flush();
console.log(`Swarm 1 flushed`);

// Swarm 2
swarm2.join(drive1.discoveryKey, { server: false, client: true });
swarm2.on('connection', (conn) => drive2.replicate(conn));
await swarm2.flush();
console.log(`Swarm 2 flushed`);

/////
await drive1.put('hello', 'world').then(() => console.log(`Drive 1: Put done`));
// await drive1.flush();

await wait(100);

await drive1.get('hello').then((data) => console.log(`Drive 1: Get done: ${data?.toString()}`));
await drive2.get('hello').then((data) => console.log(`Drive 2: Get done: ${data?.toString()}`));

process.on('SIGINT', async () => {
  console.log(`Exiting`);
  await drive1.close();
  await drive2.close();
  await store1.close();
  await store2.close();
  await swarm1.destroy();
  await swarm2.destroy();
  console.log(`Exited`);
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
