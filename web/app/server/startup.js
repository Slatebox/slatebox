/* eslint-disable no-underscore-dangle */
/* eslint-disable no-undef */
import { Meteor } from 'meteor/meteor'
import { DDP } from 'meteor/ddp-client'
// import { Log } from 'meteor/logging'
import { Accounts } from 'meteor/accounts-base'
// import ip from 'ip'
// import { Servers } from '../imports/api/common/models'
import setup from './email/setup'
import './bootstrap/all'

Meteor.startup(() => {
  // setup mail
  setup()

  // const ownIp = ip.address()

  // swallow debug messages
  Meteor._debug = (function (superMeteorDebug) {
    return function (error, info) {
      if (error !== 'discarding unknown livedata message type') {
        superMeteorDebug(error, info)
      }
    }
  })(Meteor._debug)

  Accounts.onCreateUser((suggested, user) => {
    const muser = user
    muser.isAnonymous = suggested.isAnonymous || false
    if (suggested.orgId) {
      muser.orgId = suggested.orgId
    } else {
      muser.planType = suggested.planType || 'free'
    }
    if (suggested.userName) muser.userName = suggested.userName
    if (suggested.profile) muser.profile = suggested.profile
    if (suggested.isDemo) muser.isDemo = suggested.isDemo
    return muser
  })

  // // to do: get pod internal IPs and insert them here (10.2.0.50)
  // if (!Servers.findOne()) {
  //   if (Meteor.settings.env === 'dev') {
  //     Servers.insert({ internal: 'localhost:3000', active: true })
  //     Servers.insert({ internal: 'localhost:4000', active: true })
  //   } else if (Meteor.settings.env === 'test') {
  //     Servers.insert({ internal: '10.42.3.16:3000', active: true })
  //     Servers.insert({ internal: '10.42.4.11:3000', active: true })
  //   } else if (Meteor.settings.env === 'prod') {
  //     Servers.insert({ internal: '192.168.208.100:3000', active: true })
  //     Servers.insert({ internal: '192.168.201.170:3000', active: true })
  //     Servers.insert({ internal: '192.168.212.88:3000', active: true })
  //   }
  // }

  // Servers.find()
  //   .fetch()
  //   .forEach((s) => {
  //     // this is a server proxy for Streamy to push from other web servers to the client
  //     if (s.internal !== ownIp && s.active) {
  let host = ''
  if (Meteor.settings.env === 'prod') {
    host = 'slatebox-prod-service'
  } else if (Meteor.settings.env === 'test') {
    host = 'slatebox-test-service'
  } else if (Meteor.settings.env === 'stage') {
    host = 'slatebox-stage-service'
  } else if (Meteor.settings.env === 'dev') {
    host = 'localhost:3000'
  }
  const connection = DDP.connect(host) // always use internal for ddp
  const streamyConnection = new Streamy.Connection(connection)

  // Attach message handlers
  connection._stream.on('message', (data) => {
    const parsedData = JSON.parse(data)
    if (!parsedData.processed && parsedData.msg) {
      // Retrieve the msg value
      const { msg } = parsedData
      // parsedData.__fromServer = s.host
      // And dismiss it
      delete parsedData.msg

      parsedData.processed = true
      // now we have it FROM the foreign server, so broadcast it on the LOCAL server
      if (msg.indexOf('streamy$') > -1) {
        const slateId = msg.split('streamy$')[1]
        Streamy.broadcast(slateId, parsedData)
      }
    }
  })

  // call when connect to localhost:4000 success
  streamyConnection.onConnect(() => {
    // console.log(`Connected to ${s.internal}`)
  })

  streamyConnection.onDisconnect(() => {
    // console.log(`Disconnected from ${s.internal}`)
  })
  // }
  // })

  // allow broadcasts
  Streamy.BroadCasts.allow = (data, from) =>
    // from is the socket object
    // data contains raw data you can access:
    //  - the message via data.__msg
    //  - the message data via data.__data
    true
})
