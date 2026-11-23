import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { useTheme } from '@mui/material/styles'
import CONSTANTS from '../../api/common/constants'
import { Messages } from '../../api/common/models'
import PayNotice from './PayNotice'
import { refusalForViewer } from './billing/pay/pay-notice.mjs'

export default function TranscriptionText({ slateShareId }) {
  const theme = useTheme()

  useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.transcripts, { slateShareId })
  })

  const messages = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.messages, {
      types: [CONSTANTS.messageTypes.chat],
      slateShareId,
    })
    return Messages.find(
      { type: CONSTANTS.messageTypes.chat },
      { sort: { timestamp: -1 } }
    ).fetch()
  })

  return (
    <TableContainer
      component={Paper}
      sx={{
        width: '100%',
        marginTop: theme.spacing(3),
        overflowX: 'auto',
      }}
    >
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow sx={{ background: '#303030' }}>
            <TableCell
              sx={{
                width: 300,
                position: 'sticky',
                left: 0,
                zIndex: 999,
                boxShadow: '2px 2px 2px #000',
              }}
            >
              User
            </TableCell>
            <TableCell
              sx={{
                width: 300,
                position: 'sticky',
                left: 0,
                zIndex: 999,
                boxShadow: '2px 2px 2px #000',
              }}
            >
              Time
            </TableCell>
            <TableCell
              sx={{
                width: 300,
                position: 'sticky',
                left: 0,
                zIndex: 999,
                boxShadow: '2px 2px 2px #000',
              }}
            >
              Message
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {messages?.map((m, index) => (
            <TableRow
              key={m._id}
              sx={{ bgcolor: index % 2 ? 'background.paper' : 'shell.offset' }}
            >
              <TableCell key={`cell_username_${m._id}`}>{m.author}</TableCell>
              <TableCell key={`cell_timestamp_${m._id}`}>
                {new Date(m.timestamp).toLocaleTimeString()}
              </TableCell>
              <TableCell key={`cell_message_${m._id}`}>
                {m.text}
                {/* a refusal of this person's own request: the pay sheet's action, for them only */}
                <PayNotice refusal={refusalForViewer(m, Meteor.userId())} from="draft" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
