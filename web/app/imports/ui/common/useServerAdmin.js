// Whether the signed-in account administers this Slatebox server (the uberMensch claim, no team
// needed): null while unknown, then true or false. The server answers (admin.status, for the
// caller's own account only) and stays the gate: every admin page's methods check the claim again.
// The answer is asked once per account and shared by every component that wants it.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import CONSTANTS from '../../api/common/constants'

const answers = new Map()

export function serverAdminFor(userId) {
  if (!userId) return Promise.resolve(false)
  if (!answers.has(userId)) {
    const asked = Meteor.callAsync(CONSTANTS.methods.admin.status)
      .then((answer) => answer?.admin === true, () => {
        answers.delete(userId)
        return false
      })
    answers.set(userId, asked)
  }
  return answers.get(userId)
}

export default function useServerAdmin() {
  const { userId, guest } = useTracker(() => ({ userId: Meteor.userId(), guest: Boolean(Meteor.user()?.isAnonymous) }))
  const [known, setKnown] = React.useState({ userId: null, admin: null })
  React.useEffect(() => {
    let live = true
    if (!userId || guest) {
      setKnown({ userId, admin: false })
      return undefined
    }
    serverAdminFor(userId).then((admin) => { if (live) setKnown({ userId, admin }) })
    return () => { live = false }
  }, [userId, guest])
  if (!userId) return false
  return known.userId === userId ? known.admin : null
}
