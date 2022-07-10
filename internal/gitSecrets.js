// run these aliases: setsbprodk8 AND setsbtestk8 prior to running this

// these are saved in github secrets in base64 because they are directly put into k3 as secrets, and those need to be base64 encoded
// and the workflow cannot read the actual value and convert in realtime, so they are put in immediately as base64 this way

for (let env of [
  "PROD_ROOT_URL",
  "PROD_MONGO_URL",
  "PROD_MONGO_OPLOG_URL",
  "PROD_PORT",
  "PROD_METEOR_SETTINGS",
  "TEST_ROOT_URL",
  "TEST_MONGO_URL",
  "TEST_MONGO_OPLOG_URL",
  "TEST_PORT",
  "TEST_METEOR_SETTINGS",
]) {
  console.log(`${env}: ${Buffer.from(process.env[env]).toString("base64")}`);
}

// copy and paste the base64 results into github - future todo - automate this
