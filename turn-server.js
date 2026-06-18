const Turn = require('node-turn');
const username = process.env.TURN_USERNAME;
const password = process.env.TURN_PASSWORD;
const port = Number(process.env.TURN_PORT || 3478);

if (!username || !password) {
    console.error('Missing TURN credentials. Set TURN_USERNAME and TURN_PASSWORD.');
    process.exit(1);
}

const server = new Turn({
    // set options
    authMech: 'long-term',
    credentials: {
        [username]: password
    },
    listeningPort: port,
    listeningIps: ['0.0.0.0'],
    // debug: true
});

server.start();
console.log(`Cove TURN Relay Server started on port ${port}`);
