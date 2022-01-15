import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { Servers } from '../imports/api/common/models.js';
import setup from './email/setup';
import './bootstrap/all.js';

Meteor.startup(() => {

  //setup mail
  setup();

  //monti
  //Monti.connect('565dQDEy2sxdFJScd', '6c183fb3-8f74-413f-98b0-4aa4028051b0');

  Accounts.onCreateUser(function (suggested, user) {
    user.isAnonymous = suggested.isAnonymous || false;
    if (suggested.orgId) {
      user.orgId = suggested.orgId;
    } else {
      user.planType = suggested.planType || "free";
    }
    if (suggested.userName) user.userName = suggested.userName;
    if (suggested.profile) user.profile = suggested.profile;
    if (suggested.isDemo) user.isDemo = suggested.isDemo;
    return user;
  });

  if (!Servers.findOne()) {
    if (Meteor.settings.env === "dev") {
      Servers.insert({ external: "localhost:3000", internal: "localhost:3000", active: true });
      Servers.insert({ external: "localhost:4000", internal: "localhost:4000", active: true })
    } else {
      Servers.insert({ external: "45.56.96.205:3000", internal: "192.168.208.100:3000", active: true });
      Servers.insert({ external: "69.164.214.64:3000", internal: "192.168.201.170:3000", active: true });
      Servers.insert({ external: "172.104.26.237:3000", internal: "192.168.212.88:3000", active: true });
    }
  }

  console.log("Meteor absolute URL is ", Meteor.absoluteUrl()); //is external

  for (let s of Servers.find().fetch()) {
    let serverIP = Meteor.absoluteUrl().replace(/http:\/\//gi, "").replace("/", "");

    //this is a server proxy for Streamy to push from other web servers to the client
    console.log("comparing servers ", serverIP, s.external, s.active);
    if (s.external !== serverIP && s.active) { 

      let connection = DDP.connect(s.internal); //always use internal for ddp
      let streamyConnection = new Streamy.Connection(connection);

      console.log("stream - set up message listener", serverIP);
      // Attach message handlers
      connection._stream.on('message', function onMessage(data) {

        let parsed_data = JSON.parse(data);
        if (!parsed_data.processed && parsed_data.msg) {
          // Retrieve the msg value
          let msg = parsed_data.msg;
          parsed_data.__fromServer = s.host;
          // And dismiss it
          delete parsed_data.msg;

          parsed_data.processed = true;
          //now we have it FROM the foreign server, so broadcast it on the LOCAL server
          if (msg.indexOf("streamy$") > -1) {
            let slateId = msg.split("streamy$")[1];
            console.log("sending streamy broadcast", slateId, parsed_data);
            Streamy.broadcast(slateId, parsed_data);
          }
        }
      });

      // call when connect to localhost:4000 success
      streamyConnection.onConnect(function() {
        console.log(`Connected to ${s.internal}`);
      });

      streamyConnection.onDisconnect(function() {
        console.log(`Disconnected from ${s.internal}`);
      });
    }
  }
  
  //allow broadcasts
  Streamy.BroadCasts.allow = function(data, from) {
    // from is the socket object
    // data contains raw data you can access:
    //  - the message via data.__msg
    //  - the message data via data.__data
    return true;
  };

})