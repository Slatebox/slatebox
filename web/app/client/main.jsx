/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Provider } from 'react-redux'
import { Log } from 'meteor/logging'
import { Meteor } from 'meteor/meteor'
import { render } from 'react-dom'
import has from 'lodash.has'
import i18n from 'meteor/universe:i18n'
import App from '../imports/ui/App'
import store from './store'

Meteor.startup(() => {
  // options
  i18n.setOptions({
    hostUrl: `${Meteor.settings.public.baseUrl}/`,
  })

  render(
    <Provider store={store}>
      <App />
    </Provider>,
    document.getElementById('react-target')
  )

  // swallow debug messages
  Meteor._debug = (function (superMeteorDebug) {
    return function (error, info) {
      if (error !== 'discarding unknown livedata message type') {
        superMeteorDebug(error, info)
      }
    }
  })(Meteor._debug)
})
