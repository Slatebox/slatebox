import { Meteor } from 'meteor/meteor'
import { useNavigate, useParams } from 'react-router-dom'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'

// ONLY USED FOR TESTING
export default function SimulateUrlAction() {
  const { type, identifier } = useParams()
  const history = useNavigate()
  async function getToken() {
    const token = await Meteor.callAsync(
      CONSTANTS.methods.users.getTokenByEmailForTesting,
      { email: identifier, type }
    )
    history(`/verify-email/${token}`)
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
