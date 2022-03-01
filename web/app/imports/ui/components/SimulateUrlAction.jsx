import { Meteor } from 'meteor/meteor'
import { useHistory, useParams } from 'react-router-dom'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'

// ONLY USED FOR TESTING
export default function SimulateUrlAction() {
  const { type, identifier } = useParams()
  const history = useHistory()
  async function getToken() {
    const token = await promisify(
      Meteor.call,
      CONSTANTS.methods.users.getTokenByEmailForTesting,
      { email: identifier, type }
    )
    history.push(`/verify-email/${token}`)
  }
  switch (type) {
    case 'verifyEmail': {
      getToken()
      break
    }
    default:
      break
  }

  return null
}
