import { Meteor } from 'meteor/meteor';
import { useHistory } from "react-router-dom";
import { useLocation } from "react-router";
import { promisify } from '../../api/client/promisify';
import { CONSTANTS } from '../../api/common/constants';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export const StripeManagement = () => {
  const history = useHistory();
  const query = useQuery();
  const sessionId = query.get("session_id");
  console.log("session is ", sessionId);
  async function updateUser() {
    let customerExists = await promisify(Meteor.call, CONSTANTS.methods.stripe.confirmPayment, { sessionId: sessionId });
    if (customerExists) {
      //invoke confetti?
      console.log("should have set user session");
      history.push("/");
    } else {
      console.log("webhook never fired - are you stripe forwarding on the command line?");
      //issue with webhook? should not happen
    }
  }
  updateUser();
  return null;
}