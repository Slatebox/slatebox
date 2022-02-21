import { Meteor } from 'meteor/meteor';
import { useHistory } from "react-router-dom";
import { promisify } from '../../api/client/promisify.js';
import { CONSTANTS } from '../../api/common/constants.js';
import { useParams } from 'react-router-dom';

//ONLY USED FOR TESTING
export const SimulateUrlAction = () => {
  const { type, identifier } = useParams();
  const history = useHistory();
  async function getToken() {
    const token = await promisify(Meteor.call, CONSTANTS.methods.users.getTokenByEmailForTesting, { email: identifier, type: type });
    console.log("got token", token);
    history.push(`/verify-email/${token}`);
  }
  switch (type) {
    case "verifyEmail": {
      getToken();
      break;
    }
  }
  
  return null;
}