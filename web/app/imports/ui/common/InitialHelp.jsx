/* eslint-disable no-nested-ternary */
/* eslint-disable no-underscore-dangle */
import React, { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { useLocation } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import CONSTANTS from '../../api/common/constants'
import promisify from '../../api/client/promisify'
import confirmService from './confirm'
import {
  pulseCurrentHelpStatus,
  createSlateWithAIContent,
} from '../jotai/atoms'

export default function InitialHelp() {
  const theme = useTheme()
  const locale = useLocation()
  const setHelpStatus = useSetAtom(pulseCurrentHelpStatus)
  const currentAIContext = useAtomValue(createSlateWithAIContent)

  async function getHelpStatus() {
    const cutPath =
      locale.pathname.length > 1
        ? `/${locale.pathname.split('/')[1]}`
        : locale.pathname
    const getHS = await Meteor.callAsync(
      CONSTANTS.methods.users.getHelpStatus,
      { path: cutPath }
    )

    if (
      ((currentAIContext && !currentAIContext?.aid) || cutPath === '/') &&
      getHS?.status?.firstTime
    ) {
      if (getHS.welcomeMessage && cutPath !== '/canvas') {
        await confirmService.show({
          theme,
        title: getHS.welcomeMessage.title,
        message: getHS.welcomeMessage.body,
          actionItems: [{ label: 'OK', return: true }],
        })
      }
      await Meteor.callAsync(CONSTANTS.methods.users.setHelpStatus, {
        confirmFirstTime: true,
      })
      setHelpStatus({
        pulseCurrentPath: true,
      })
    } else if (!getHS?.status?.locales.includes(cutPath)) {
      await Meteor.callAsync(CONSTANTS.methods.users.setHelpStatus, {
        path: cutPath,
      })
      setHelpStatus({
        pulseCurrentPath: true,
      })
    } else if (getHS?.slateCount > 3) {
      setHelpStatus({
        pulseCurrentPath: false,
      })
    }
  }

  useEffect(() => {
    getHelpStatus()
  }, [locale, currentAIContext])

  return null
}
