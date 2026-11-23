// imports/i18n/i18n.tsx
import { i18n } from 'meteor/universe:i18n'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

function loadLocale(loc) {
  // console.log('loading locale', loc)
  i18n.setLocale(loc)
}
const loc =
  (navigator.languages && navigator.languages[0]) ||
  navigator.language ||
  navigator.browserLanguage ||
  navigator.userLanguage ||
  'en-US'

// if (!ACCEPTED_LOCALES.includes(loc)) {
//   loc = 'en-US'
// }
loadLocale(loc)

const localeContext = createContext(i18n.getLocale())

export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState(i18n.getLocale())
  useEffect(() => {
    i18n.onChangeLocale(setLocale)
    return () => {
      i18n.offChangeLocale(setLocale)
    }
  }, [setLocale])

  return (
    <localeContext.Provider value={locale}>{children}</localeContext.Provider>
  )
}

export function useLocale() {
  return useContext(localeContext)
}

export function useTranslator(prefix = '') {
  const locale = useLocale()
  // console.log('getting translation', prefix)
  return useCallback(
    (key, ...args) => {
      const translation = i18n.getTranslation(prefix, key, ...args)
      // console.log('prefix key', { prefix, key, translation })
      return translation
    },
    [locale]
  )
}

export function getTranslation(namespace, key) {
  return i18n.__(namespace, key)
}
