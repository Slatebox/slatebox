
// const sodium = require('tweetsodium');
// const key = "base64-encoded-public-key";
// const value = "plain-text-secret";


// // Convert the message and key to Uint8Array's (Buffer implements that interface)
// const messageBytes = Buffer.from(value);
// const keyBytes = Buffer.from(key, 'base64');


// // Encrypt using LibSodium.
// const encryptedBytes = sodium.seal(messageBytes, keyBytes);


// // Base64 the encrypted secret
// const encrypted = Buffer.from(encryptedBytes).toString('base64');

// call setsbprodenv prior to running this

for (let env of ["ROOT_URL", "MONGO_URL", "MONGO_OPLOG_URL", "PORT", "METEOR_SETTINGS"]) {
    console.log(`${env}: ${Buffer.from(process.env[env]).toString("base64")}`);
}