import { Accounts } from 'meteor/accounts-base'

// The upload route answers only a signed-in browser, which proves it with its login token.
const uploadHeaders = () => ({ 'X-Slatebox-Login-Token': Accounts._storedLoginToken() || '' })
export default uploadHeaders
