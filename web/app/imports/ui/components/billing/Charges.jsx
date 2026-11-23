import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import { amountText, dayText } from './money'

// Top-ups, refunds and what the balance paid for, newest first.
export default function Charges({ wallet }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    Meteor.callAsync(CONSTANTS.methods.wallet.charges, { wallet }).then(setRows).catch(() => setRows([]))
  }, [wallet])
  if (!rows.length) return null
  return (
    <Box sx={{ pt: 1 }}>
      <Typography variant="subtitle1" sx={{ mb: 0.5 }}>Charges</Typography>
      {rows.map((row, i) => (
        <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '5em 1fr auto', columnGap: 2, py: 0.5 }}>
          <Typography variant="body2">{dayText(row.at)}</Typography>
          <Typography variant="body2">{row.label}</Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{amountText(row.amount)}</Typography>
        </Box>
      ))}
    </Box>
  )
}

Charges.propTypes = { wallet: PropTypes.oneOf(['me', 'team']).isRequired }
