/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useHistory } from 'react-router-dom'
import { useTheme } from '@material-ui/core'
import { Messages } from '../../api/common/models'
import confirmService from '../common/confirm'
import CONSTANTS from '../../api/common/constants'

export default function MessageListener(props) {
  const history = useHistory(props)
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
      history.push(onOK)
    }
  }

  let systemMessages = []
  useTracker(() => {
    // get all messages
    Meteor.subscribe(CONSTANTS.publications.messages, {
      type: CONSTANTS.messageTypes.system,
    })
    // if statement necessary to trigger reactivity
    if (
      Messages.find(
        { read: false, priority: 10, type: CONSTANTS.messageTypes.system },
        { sort: { timestamp: -1 } }
      ).count() > 0
    ) {
      // do something with the messages - priority = 10 means a global dispatch, effect='celebration' means baloons or something!
      systemMessages = Messages.find({
        read: false,
        priority: 10,
        type: CONSTANTS.messageTypes.system,
      })
        .fetch()
        .sort((a, b) => a.timestamp - b.timestamp)
      const celebrate = systemMessages.some((m) => m.effect === 'celebrate')
      if (systemMessages.length > 0) {
        message(
          systemMessages[0].title,
          systemMessages.map((a) => a.text).join(', '),
          systemMessages[0].onOK
        )
        // dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: false, text: , severity: "success", autoHide: 60000 } });
        systemMessages.forEach((a) => {
          Messages.update({ _id: a._id }, { $set: { read: true } })
        })
      }
    }
  })

  return null
}
