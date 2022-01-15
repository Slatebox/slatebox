import intersection from "lodash.intersection"
import uniq from "lodash.uniq"
import { CONSTANTS } from "./constants";
import { Permissions, Claims } from '/imports/api/common/models.js';

export default class AuthManager {
	static userHasClaim(userId, claims, mustBeInAll) {
		if (!claims.filter) claims = [claims];
    //always add admin to the list
    claims = uniq(claims.concat(CONSTANTS.claims.admin._id));
		const permissions = Permissions.find({ userId: userId }).fetch();
    // if (permissions.length === 0) {
    //   console.log("EMPTY PERMS FOUND", permissions);
    //   console.trace();
    // }
		const claimIds = permissions.map((p) => { return p.claimId });
		//const claimNames = Claims.find({ _id: { $in: claimIds } }).fetch().map(c => c._id);
    //claimNames  [ 'admin' ] [ 'admin' ] undefined [ 'admin' ]
    // console.log("claimNames ", claimIds, claims, mustBeInAll, intersection(claimIds, claims));
		if (mustBeInAll) {
			return intersection(claimIds, claims).length === claims.length;
		} else {
			return intersection(claimIds, claims).length > 0;
		}
	}
}