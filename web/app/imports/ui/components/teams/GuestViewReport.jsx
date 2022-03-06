import React, { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { makeStyles } from '@material-ui/core/styles'
import { useDispatch } from 'react-redux'
import Table from '@material-ui/core/Table'
import TableBody from '@material-ui/core/TableBody'
import TableCell from '@material-ui/core/TableCell'
import TableContainer from '@material-ui/core/TableContainer'
import TableHead from '@material-ui/core/TableHead'
import TableRow from '@material-ui/core/TableRow'
import Paper from '@material-ui/core/Paper'
import Typography from '@material-ui/core/Typography'
import Grid from '@material-ui/core/Grid'
import promisify from '../../../api/client/promisify'
import CONSTANTS from '../../../api/common/constants'

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

export default function GuestViewReport() {
  const classes = useStyles()
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

  return (
    <Grid container justify="flex-end" alignItems="center" spacing={2}>
      <Grid item xs={5}>
        <Typography variant="h6" color="secondary">
          Guest Report
        </Typography>
      </Grid>
      {data?.dataRows?.length > 0 ? (
        <TableContainer component={Paper} className={classes.root}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow className={classes.darkRow}>
                {data?.headerRow?.map((header) => (
                  <TableCell key={header} className={classes.sticky}>
                    {header}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.dataRows?.map((row, index) => (
                <TableRow
                  key={row}
                  className={index % 2 ? classes.lightRow : classes.darkRow}
                >
                  {row?.map((rx) => (
                    <TableCell key={`cell_${rx}`}>{rx}</TableCell>
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
    </Grid>
  )
}
