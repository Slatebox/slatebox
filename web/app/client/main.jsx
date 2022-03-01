import React from 'react'
import { Provider } from 'react-redux'
import store from './store'
import { Meteor } from 'meteor/meteor'
import { render } from 'react-dom'
import App from '../imports/ui/App.jsx'
import has from 'lodash.has'
import i18n from 'meteor/universe:i18n'

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

  //swallow debug messages
  Meteor._debug = (function (super_meteor_debug) {
    return function (error, info) {
      if (!(info && has(info, 'msg'))) {
        super_meteor_debug(error, info)
      }
    }
  })(Meteor._debug)
})
