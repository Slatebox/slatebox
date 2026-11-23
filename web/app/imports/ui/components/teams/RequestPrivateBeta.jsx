/* eslint-disable react/jsx-props-no-spreading */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import PropTypes from 'prop-types'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'

export default function RequestPrivateBeta({ title }) {
  return (
    <Box p={5}>
      <Typography color="secondary" variant="h5">
        {title}
      </Typography>
      <Typography style={{ color: '#fff' }} variant="body2">
        Want to join? Reach out and we'll get you on the waitlist.
      </Typography>
      <Box marginTop={5}>
        <Link
          style={{ color: '#fff', fontSize: '24pt' }}
          href={`mailto:beta@slatebox.com?subject=Teams Private Beta&body=I'd love to be on the waitlist! My identifier is ${Meteor.userId()}`}
        >
          Add me to the waitlist &rarr;
        </Link>
      </Box>
    </Box>
  )
}

// RequestPrivateBeta.propTypes = {
//   title: PropTypes.string,
// }

// RequestPrivateBeta.PropTypes.defaultProps = {
//   title: `Sorry, you cannot create a team right now. Slatebox Teams is in
//   private beta.`,
// }
