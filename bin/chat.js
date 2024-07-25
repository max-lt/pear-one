/* global Pear */
import Hyperswarm from 'hyperswarm'; // Module for P2P networking and connecting peers
import b4a from 'b4a'; // Module for buffer-to-string and vice-versa conversions
import crypto from 'hypercore-crypto'; // Cryptographic functions for generating the key in app
import readline from 'node:readline/promises';
import Corestore from 'corestore';
import RAM from 'random-access-memory';
import Hyperdrive from 'hyperdrive';
import tty from 'node:tty';

const args = process.argv;

const COMMANDS = ['join'];
const cmd = args[2];
const room = args[3];

if (!COMMANDS.includes(cmd)) {
  const last = (str) => str.split('/').pop();
  console.error(`[error] Invalid command: ${cmd}; Usage: ${last(args[0])} ${last(args[1])} join <channel> [as <name>]`);
  process.exit(1);
}

if (!room) {
  console.error('[error] Chat room key is required');
  process.exit(1);
}

// Generate a 32 byte seed for the drive, this will be used as chat room key as well
const roomId = crypto.hash(Uint8Array.from(room, (c) => c.charCodeAt(0)));
const driveId = crypto.hash(roomId);

const name = (args[4] === 'as' && args[5]) || 'anon-' + Math.random().toString(36).slice(2, 8);
const nameSymbol = Symbol('peer-name');

const swarm = new Hyperswarm();

///////////////////
/////  DRIVE  /////
///////////////////
// https://docs.pears.com/how-tos/create-a-full-peer-to-peer-filesystem-with-hyperdrive
let driveInitLock = false;
async function initDrive(key) {
  if (driveInitLock) {
    console.log(`Drive init already in progress`);
    return;
  }

  driveInitLock = true;

  console.log(`${key ? 'Joining' : 'Creating'} drive...`, { server: !key, client: !!key });

  const store = new Corestore(RAM);
  await store.ready();
  console.log(`Store ready`);

  const drive = new Hyperdrive(store, key);
  await drive.ready();

  // Mark the drive as finding peers
  // const done = drive.findingPeers();
  console.log(`Drive ready`);

  // Join the swarm as a server if no key is provided, otherwise join as a client
  const swarm = new Hyperswarm();
  swarm.join(driveId, { server: !key, client: !!key });
  // swarm.join(drive.discoveryKey, { server: !key, client: !!key });
  swarm.on('connection', (conn) => drive.replicate(conn));
  await swarm.flush(); //.then(done, done);

  console.log(`Drive swarm ready`);

  return drive;
}

let drive = null;

const rl = readline.createInterface({
  input: new tty.ReadStream(0),
  output: new tty.WriteStream(1)
});

// When there's a new connection, listen for new messages, and output them to the terminal
swarm.on('connection', (conn) => {
  const peerName = b4a.toString(conn.remotePublicKey, 'hex').substr(0, 6);
  appendMessage('info', `Peer ${peerName} joined`);

  conn.write(`/name?`);

  if (!drive) {
    console.debug(`Drive key not set, requesting from peer ${peerName}`);
    conn.write(`/drive_key?`);
  }

  conn.on('data', async (message) => {
    const messageStr = message.toString();

    if (messageStr === '/name?') {
      conn.write(`/name=${name}`);
      return;
    }

    if (messageStr === '/drive_key?') {
      if (drive) {
        conn.write(`/drive_key=${drive.key.toString('hex')}`);
      }
      return;
    }

    if (messageStr.startsWith('/name=')) {
      appendMessage('info', `Peer ${peerName} is now known as ${messageStr.substr(6)}`);
      conn[nameSymbol] = messageStr.substr(6);
      return;
    }

    if (messageStr.startsWith('/drive_key=')) {
      if (drive) {
        appendMessage('info', `Drive already set`);
        return;
      }

      appendMessage('info', `Received drive key: ${messageStr.substr(11)}`);
      drive = await initDrive(b4a.from(messageStr.substr(11), 'hex'));
      appendMessage('info', `Drive set from peer ${peerName}`);
      return;
    }

    appendMessage(conn[nameSymbol] ?? peerName, messageStr);
  });

  conn.on('error', (e) => {
    if (e.code !== 'ECONNRESET') {
      appendMessage('error', `Connection error: ${e} ${e.code}`);
    } else {
      appendMessage('info', `Peer ${peerName} left`);
    }
  });
});

await joinChatRoom();

rl.input.setRawMode(true); // Enable raw input mode for efficient key reading
rl.on('line', async (line) => {
  const setCmdRegex = /^set\s+(\S+)\s+(.*)$/;
  if (line.startsWith('set ')) {
    const match = setCmdRegex.exec(line);
    if (!match) {
      appendMessage('error', 'Invalid set command');
      return;
    }

    let [, key, value] = match;
    appendMessage('debug', `Setting key: ${key} to value: ${value}`);

    try {
      await drive.put(key, value).then(() => console.log(`Drive: Put done`));
      appendMessage('debug', `Value for key: ${key} set to: ${value}`);
    } catch (err) {
      console.error(err);
      appendMessage('error', `Error setting value for key: ${key}`);
    }

    return;
  }

  const getCmdRegex = /^get\s+(\S+)$/;
  if (line.startsWith('get ')) {
    const match = getCmdRegex.exec(line);
    if (!match) {
      appendMessage('error', 'Invalid get command');
      return;
    }

    let [, key] = match;
    appendMessage('debug', `Getting value for key: ${key}`);

    try {
      const value = await drive.get(key);
      appendMessage('debug', `Value for key: ${key} is: ${value}`);
    } catch (err) {
      console.error(err);
      appendMessage('error', `Error getting value for key: ${key}`);
    }

    return;
  }

  broadcast(line);
  rl.prompt();
});
rl.prompt();

rl.on('close', async () => {
  console.log('\r[info] Exiting chat room');
  rl.input.setRawMode(false); // Reset the terminal to normal mode
  rl.input.destroy();
  swarm.destroy();
});

async function joinChatRoom() {
  const topicHex = b4a.toString(roomId, 'hex');

  rl.output.write(`[info] Joining chat room ${room} (${topicHex})\n...`);

  const discovery = swarm.join(roomId, { client: true, server: true });
  await discovery.flushed();

  appendMessage('info', `Joined chat room ${room} (${topicHex})`);

  // If drive is not set after 10 seconds, generate a new drive
  setTimeout(async () => {
    if (!drive) {
      try {
        appendMessage('info', `Generating new drive`);
        drive = await initDrive(null);
        appendMessage('info', `Generated new drive with key ${drive.key.toString('hex')}`);
      } catch (err) {
        console.error(err);
        appendMessage('error', `Error generating new drive`);
      }
    }
  }, 10_000);
}

// Send the message to all peers (that you are connected to)
function broadcast(message) {
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
