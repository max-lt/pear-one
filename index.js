/* global Pear */
import Hyperswarm from 'hyperswarm'; // Module for P2P networking and connecting peers
import b4a from 'b4a'; // Module for buffer-to-string and vice-versa conversions
import crypto from 'hypercore-crypto'; // Cryptographic functions for generating the key in app
import readline from 'bare-readline'; // Module for reading user input in terminal
import process from 'bare-process';
import tty from 'bare-tty'; // Module to control terminal behavior

const { teardown, config } = Pear; // Import configuration options and cleanup functions from Pear
const COMMANDS = ['join'];
const room = config.args.pop();
const cmd = config.args.pop();

if (!COMMANDS.includes(cmd)) {
  console.error(`[error] Invalid command: ${cmd}; Usage: pear dev . join [key]`);
  process.exit(1);
}

const swarm = new Hyperswarm();

// Unannounce the public key before exiting the process
// (This is not a requirement, but it helps avoid DHT pollution)
teardown(() => swarm.destroy());

const rl = readline.createInterface({
  input: new tty.ReadStream(0),
  output: new tty.WriteStream(1)
});

// When there's a new connection, listen for new messages, and output them to the terminal
swarm.on('connection', (peer) => {
  const name = b4a.toString(peer.remotePublicKey, 'hex').substr(0, 6);
  appendMessage('info', `Peer ${name} joined`);
  peer.on('data', (message) => appendMessage(name, message));
  peer.on('error', (e) => {
    if (e.code !== 'ECONNRESET') {
      appendMessage('error', `Connection error: ${e} ${e.code}`);
    } else {
      appendMessage('info', `Peer ${name} left`);
    }
  });
});

// When there's updates to the swarm, update the peers count
swarm.on('update', () => {
  // console.log(`[info] Number of connections is now ${swarm.connections.size}`);
});

await joinChatRoom(room);

rl.input.setMode(tty.constants.MODE_RAW); // Enable raw input mode for efficient key reading
rl.on('data', (line) => {
  sendMessage(line);
  rl.prompt();
});
rl.prompt();

rl.on('close', async () => {
  console.log('[info] Exiting chat room');
  rl.input.setMode(tty.constants.MODE_NORMAL); // Reset the terminal to normal mode
  rl.input.destroy();
  swarm.destroy();
});

async function joinChatRoom(topicStr) {
  const topicBuffer = crypto.hash(Uint8Array.from(Buffer.from(topicStr, 'hex')));
  const topicHex = b4a.toString(topicBuffer, 'hex');

  await joinSwarm(topicBuffer);

  appendMessage('info', `Joined chat room ${topicStr} (${topicHex})`);
}

// Join the swarm with the topic. Setting both client/server to true means that this app can act as both.
async function joinSwarm(topicBuffer) {
  const discovery = swarm.join(topicBuffer, { client: true, server: true });
  await discovery.flushed();
}

// Send the message to all peers (that you are connected to)
function sendMessage(message) {
  const peers = [...swarm.connections];
  for (const peer of peers) peer.write(message);
}

// Output chat msgs to terminal
function appendMessage(name, message) {
  console.log(`\r[${name}] ${message}`);
  rl.prompt();
}
