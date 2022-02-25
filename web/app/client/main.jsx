/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Provider } from 'react-redux'
import { Meteor } from 'meteor/meteor'
import { render } from 'react-dom'
import has from 'lodash.has'
import i18n from 'meteor/universe:i18n'
import store from './store'
import App from '../imports/ui/App'

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
  Meteor._debug = ((superMeteorDebug) => (error, info) => {
    if (!(info && has(info, 'msg'))) {
      superMeteorDebug(error, info)
    }
  })(Meteor._debug)
})
