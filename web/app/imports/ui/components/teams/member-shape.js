// The fields of a team member the team page reads (the orgUsers publication's).
import PropTypes from 'prop-types'

const memberShape = PropTypes.shape({
  _id: PropTypes.string.isRequired,
  orgId: PropTypes.string,
  isOrgOwner: PropTypes.bool,
  profile: PropTypes.shape({ firstName: PropTypes.string, lastName: PropTypes.string }),
  emails: PropTypes.arrayOf(PropTypes.shape({ address: PropTypes.string, verified: PropTypes.bool })),
})

export default memberShape
