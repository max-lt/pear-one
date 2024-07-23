/* global Pear */
import Hyperswarm from 'hyperswarm'; // Module for P2P networking and connecting peers
import b4a from 'b4a'; // Module for buffer-to-string and vice-versa conversions
import crypto from 'hypercore-crypto'; // Cryptographic functions for generating the key in app
import readline from 'node:readline/promises';
import tty from 'node:tty';

const config = {
  args: process.argv.slice(2)
};

const COMMANDS = ['join'];
const cmd = config.args[0];
const room = config.args[1];

if (!COMMANDS.includes(cmd)) {
  console.error(`[error] Invalid command: ${cmd}; Usage: pear run pear://<pear-key> join <channel> [as <name>]`);
  process.exit(1);
}

if (!room) {
  console.error('[error] Chat room key is required');
  process.exit(1);
}

const name = (config.args[2] === 'as' && config.args[3]) || 'anon-' + Math.random().toString(36).slice(2, 8);
const nameSymbol = Symbol('peer-name');

const swarm = new Hyperswarm();

const rl = readline.createInterface({
  input: new tty.ReadStream(0),
  output: new tty.WriteStream(1)
});

// When there's a new connection, listen for new messages, and output them to the terminal
swarm.on('connection', (peer) => {
  const peerName = b4a.toString(peer.remotePublicKey, 'hex').substr(0, 6);
  appendMessage('info', `Peer ${peerName} joined`);

  peer.write(`/name?`);

  peer.on('data', (message) => {
    const messageStr = message.toString();

    if (messageStr === '/name?') {
      peer.write(`/name=${name}`);
      return;
    }

    if (messageStr.startsWith('/name=')) {
      appendMessage('info', `Peer ${peerName} is now known as ${messageStr.substr(6)}`);
      peer[nameSymbol] = messageStr.substr(6);
      return;
    }

    appendMessage(peer[nameSymbol] ?? peerName, messageStr);
  });
  peer.on('error', (e) => {
    if (e.code !== 'ECONNRESET') {
      appendMessage('error', `Connection error: ${e} ${e.code}`);
    } else {
      appendMessage('info', `Peer ${peerName} left`);
    }
  });
});

await joinChatRoom(room);

rl.input.setRawMode(true); // Enable raw input mode for efficient key reading
rl.on('line', (line) => {
  sendMessage(line);
  rl.prompt();
});
rl.prompt();

rl.on('close', async () => {
  console.log('[info] Exiting chat room');
  rl.input.setRawMode(false); // Reset the terminal to normal mode
  rl.input.destroy();
  swarm.destroy();
});

async function joinChatRoom(topicStr) {
  const topicBuffer = crypto.hash(Uint8Array.from(topicStr, (c) => c.charCodeAt(0)));
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
  for (const peer of peers) {
    peer.write(message);
  }
}

// Output chat msgs to terminal
function appendMessage(name, message) {
  console.log(`\r[${name}] ${message}`);
  rl.prompt();
}
