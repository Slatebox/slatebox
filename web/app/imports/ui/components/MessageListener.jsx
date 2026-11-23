/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import React, { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { useTracker } from 'meteor/react-meteor-data'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import { Messages } from '../../api/common/models'
import confirmService from '../common/confirm'
import CONSTANTS from '../../api/common/constants'

import { globalMessage } from '../jotai/atoms'

export default function MessageListener(props) {
  const history = useNavigate(props)
  const setGlobalMessage = useSetAtom(globalMessage)
  const theme = useTheme()

  async function message(title, body, onOK) {
    await confirmService.show({
      theme,
      title,
      message: body,
      actionItems: [{ label: 'OK', return: false }],
    })
    if (onOK) {
      // redirect to page
      history(onOK)
    }
  }

  const systemMessages = useTracker(async () => {
    Meteor.subscribe(CONSTANTS.publications.messages, {
      types: [CONSTANTS.messageTypes.system],
    })
    return (
      await Messages.find({
        read: false,
        priority: 10,
        type: CONSTANTS.messageTypes.system,
      }).fetchAsync()
    ).sort((a, b) => a.timestamp - b.timestamp)
  })

  // const aiMessages = useTracker(() => {
  //   Meteor.subscribe(CONSTANTS.publications.messages, {
  //     types: [CONSTANTS.messageTypes.ai],
  //   })
  //   return Messages.find({
  //     read: false,
  //     type: CONSTANTS.messageTypes.ai,
  //   })
  //     .fetch()
  //     .sort((a, b) => a.timestamp - b.timestamp)
  // })

  if (systemMessages.length > 0) {
    async function markAsRead() {
      for (const a of systemMessages) {
        await Messages.updateAsync({ _id: a._id }, { $set: { read: true } })
      }
    }
    const celebrate = systemMessages.some((m) => m.effect === 'celebrate')
    message(
      systemMessages[0].title,
      systemMessages.map((a) => a.text).join(', '),
      systemMessages[0].onOK
    )
    markAsRead()
  }

  // if (aiMessages.length > 0) {
  //   setGlobalMessage({
  //     visible: true,
  //     text: aiMessages.map((a) => a.text).join(', '),
  //     severity: 'info',
  //     autoHide: 20000,
  //   })

  //   aiMessages.forEach((a) => {
  //     Messages.update({ _id: a._id }, { $set: { read: true } })
  //   })
  // }

  // eslint-disable-next-line jsx-a11y/media-has-caption
  return null
}
