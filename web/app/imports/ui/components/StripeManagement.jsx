import { Meteor } from 'meteor/meteor'
import { useHistory, useLocation } from 'react-router-dom'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'

function useQuery() {
  return new URLSearchParams(useLocation().search)
}

export default function StripeManagement() {
  const history = useHistory()
  const query = useQuery()
  const sessionId = query.get('session_id')
  async function updateUser() {
    const customerExists = await promisify(
      Meteor.call,
      CONSTANTS.methods.stripe.confirmPayment,
      { sessionId }
    )
    if (customerExists) {
      // invoke confetti?
      history.push('/')
    } else {
      console.error(
        'webhook never fired - are you stripe forwarding on the command line [development only]?'
      )
    }
  }
  updateUser()
  return null
}
