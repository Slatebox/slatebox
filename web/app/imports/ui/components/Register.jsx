import React from 'react'
import PropTypes from 'prop-types'

function Register({ user = { emails: [] } }) {
  // Implementation of the component
}

Register.propTypes = {
  user: PropTypes.shape({
    emails: PropTypes.arrayOf(
      PropTypes.shape({
        address: PropTypes.string,
        verified: PropTypes.bool,
      })
    ),
    // other user props...
  }),
}


export default Register
