import React from 'react'
import { Meteor } from 'meteor/meteor'
import { makeStyles } from '@material-ui/core/styles'
import { useDispatch } from 'react-redux'
import { useTheme } from '@material-ui/core'
import Table from '@material-ui/core/Table'
import TableBody from '@material-ui/core/TableBody'
import TableCell from '@material-ui/core/TableCell'
import TableContainer from '@material-ui/core/TableContainer'
import TableHead from '@material-ui/core/TableHead'
import TableRow from '@material-ui/core/TableRow'
import Paper from '@material-ui/core/Paper'
import { CONSTANTS } from '../../../api/common/constants'

import { promisify } from '../../../api/client/promisify.js'
import { useEffect } from 'react'
import Box from '@material-ui/core/Box'
import Typography from '@material-ui/core/Typography'
import Grid from '@material-ui/core/Grid'
import Button from '@material-ui/core/Button'
import { Organizations } from '../../../api/common/models'

const useStyles = makeStyles((theme) => ({
  root: {
    width: '100%',
    marginTop: theme.spacing(3),
    overflowX: 'auto',
  },
  lightRow: {
    background: '#424242',
  },
  darkRow: {
    background: '#303030',
  },
  sticky: {
    width: 300,
    position: 'sticky',
    left: 0,
    backgroundColor: '#424242',
    zIndex: 999,
    boxShadow: '2px 2px 2px #000',
  },
}))

export const GuestViewReport = (props) => {
  const classes = useStyles()
  const theme = useTheme()
  const dispatch = useDispatch()
  const [data, setRows] = React.useState({})
  useEffect(() => {
    async function getData() {
      const gdata = await promisify(
        Meteor.call,
        CONSTANTS.methods.organizations.guestViewReport
      )
      /*
      return { 
        headers: headers, 
        data: dataRows, 
        allowableUnlistedViewsPerMonth: allowableGuestViews, 
        totalUnlistedViewsByMonth: totalUnlistedViewsByMonth, 
        totalPublicViewsByMonth: totalPublicViewsByMonth, 
        totalViews: rows.length 
      };
      */
      setRows(gdata)
    }
    getData()
  }, [])

  function showSupport() {
    window.$chatwoot.toggle()
  }

  function showUpgrade() {
    dispatch({
      type: 'payment',
      paymentOpen: true,
      paymentMessage: `You are currently on the forever free plan.`,
      paymentFocus: null,
    })
  }

  let unlistedViewsThisMonth =
    data?.totalUnlistedViewsByMonth &&
    data?.totalUnlistedViewsByMonth[new Date().getMonth() + 1]
      ? data?.totalUnlistedViewsByMonth[new Date().getMonth() + 1]
      : 0

  return (
    <Grid container justify="flex-end" alignItems="center" spacing={2}>
      <Grid item xs={5}>
        <Typography variant="h6" color="secondary">
          Guest Passes
        </Typography>
      </Grid>
      <Grid item>
        <Typography
          variant="h1"
          color="secondary"
          style={{ letterSpacing: '-10px' }}
        >
          {unlistedViewsThisMonth} / {data?.allowableUnlistedViewsPerMonth}
        </Typography>
      </Grid>
      <Grid item style={{ marginLeft: '10px' }}>
        <Typography variant="overline" color="secondary">
          {data?.allowableUnlistedViewsPerMonth - unlistedViewsThisMonth} passes
          left in {new Date().toLocaleString('default', { month: 'long' })}
        </Typography>
      </Grid>
      {data?.dataRows?.length > 0 ? (
        <TableContainer component={Paper} className={classes.root}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow className={classes.darkRow}>
                {data?.headerRow?.map((header, index) => (
                  <TableCell key={index} className={classes.sticky}>
                    {header}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.dataRows?.map((row, index) => (
                <TableRow
                  key={index}
                  className={index % 2 ? classes.lightRow : classes.darkRow}
                >
                  {row?.map((rx, index) => (
                    <TableCell key={index}>{rx}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Grid item style={{ marginLeft: '10px', color: '#fff' }}>
          <Typography variant="h5">
            No guest views yet in{' '}
            {new Date().toLocaleString('default', { month: 'long' })}
          </Typography>
        </Grid>
      )}
      {Organizations?.findOne()?.planType === 'free' ? (
        <Grid item>
          <Button color="secondary" onClick={showUpgrade} variant="outlined">
            Upgrade from {data.allowableUnlistedViewsPerMonth} to{' '}
            {data.allowableUnlistedViewsPerMonthOnProTeam} guest views per month
            with Team Pro
          </Button>
        </Grid>
      ) : (
        <Grid item>
          <Button color="secondary" onClick={showSupport} variant="outlined">
            Need more guest views? Just let us know.
          </Button>
        </Grid>
      )}
    </Grid>
  )
}
