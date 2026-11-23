// import React from 'react'
// import PropTypes from 'prop-types'
// import i18n from 'meteor/universe:i18n'
// import { useAtom } from 'jotai'

// import { siteLocale } from '../recoil/atoms'

// const T = i18n.createComponent()

// // whitelist - meteor convention
// if (false) {
//   import '../../../both/i18n/en-us/common.i18n.json'
//   import '../../../both/i18n/en-us/slates.i18n.json'
//   import '../../../both/i18n/en-us/nodeDrawer.i18n.json'
//   import '../../../both/i18n/en-us/profile.i18n.json'
//   import '../../../both/i18n/en-us/chat.i18n.json'
//   import '../../../both/i18n/en-us/teamSettings.i18n.json'
// }

// export default function Translation({ children }) {
//   const [locale, setLocale] = useAtom(siteLocale)

//   const ACCEPTED_LOCALES = ['en-US']

//   async function loadLocale(loc) {
//     await import(`../../../both/i18n/${loc.toLowerCase()}/common.i18n.json`)
//     await import(`../../../both/i18n/${loc.toLowerCase()}/slates.i18n.json`)
//     await import(`../../../both/i18n/${loc.toLowerCase()}/nodeDrawer.i18n.json`)
//     await import(`../../../both/i18n/${loc.toLowerCase()}/profile.i18n.json`)
//     await import(`../../../both/i18n/${loc.toLowerCase()}/chat.i18n.json`)
//     await import(
//       `../../../both/i18n/${loc.toLowerCase()}/teamSettings.i18n.json`
//     )
//     i18n.setLocale(loc)
//   }
//   let loc =
//     (navigator.languages && navigator.languages[0]) ||
//     navigator.language ||
//     navigator.browserLanguage ||
//     navigator.userLanguage ||
//     'en-US'

//   if (!ACCEPTED_LOCALES.includes(loc)) {
//     loc = 'en-US'
//   }

//   if (!locale) {
//     // store in global cache for return
//     setLocale(loc)
//     loadLocale(loc)
//   } else {
//     loadLocale(loc)
//   }

//   return <T>{children}</T>
// }

// Translation.propTypes = {
//   children: PropTypes.node.isRequired,
// }
