/* eslint-disable no-nested-ternary */
/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useSelector, useDispatch } from 'react-redux'
import { useHistory } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import AppBar from '@material-ui/core/AppBar'
import Button from '@material-ui/core/Button'
import Card from '@material-ui/core/Card'
import CardActions from '@material-ui/core/CardActions'
import CardContent from '@material-ui/core/CardContent'
import CardHeader from '@material-ui/core/CardHeader'
import Grid from '@material-ui/core/Grid'
import StarIcon from '@material-ui/icons/StarBorder'
import Toolbar from '@material-ui/core/Toolbar'
import Typography from '@material-ui/core/Typography'
import { makeStyles } from '@material-ui/core/styles'
import Container from '@material-ui/core/Container'
import Box from '@material-ui/core/Box'
import Slide from '@material-ui/core/Slide'
import Dialog from '@material-ui/core/Dialog'
import IconButton from '@material-ui/core/IconButton'
import CloseIcon from '@material-ui/icons/Close'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import { Tooltip, useTheme } from '@material-ui/core'
import InfoIcon from '@material-ui/icons/Info'
import CONSTANTS from '../../api/common/constants'
import promisify from '../../api/client/promisify'
import confirmService from './confirm'

import { PricingTiers } from '../../api/common/models'

const useStyles = makeStyles((theme) => ({
  heroContent: {
    padding: theme.spacing(8, 0, 6),
  },
  cardHeader: {
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.secondary.main,
  },
  cardPricing: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginBottom: theme.spacing(2),
  },
  appBar: {
    position: 'relative',
  },
  title: {
    marginLeft: theme.spacing(2),
    flex: 1,
  },
  focused: {
    color: theme.palette.secondary.main,
  },
  paymentSpacing: {
    padding: '10px',
  },
}))

const Transition = React.forwardRef((props, ref) => (
  // eslint-disable-next-line react/jsx-props-no-spreading
  <Slide direction="up" ref={ref} {...props} />
))

function PriceBox({ tier, pricingPeriod, pricingLocale }) {
  const perUser = tier._id === 'solo' ? '' : '/user'
  return (
    <Grid container alignItems="center" justify="center">
      <Typography component="h2" variant="h3" color="textPrimary">
        ${pricingPeriod === 'month' ? tier.monthly.price : tier.yearly.price}
      </Typography>
      &nbsp;
      <Typography variant="h6" color="textSecondary">
        {pricingLocale === 'hosted' ? `${perUser}/mo` : '/mo'}
      </Typography>
      <Box m={1}>
        {pricingLocale === 'hosted' ? (
          tier._id === 'team' ? (
            <Typography variant="overline">
              <b>
                {pricingPeriod === 'year'
                  ? `(${Meteor.users.find().count()} members x $${
                      tier.yearly.price * 12
                    }/yr) = $${
                      Meteor.users.find().count() * (tier.yearly.price * 12)
                    }/yr`
                  : `(${Meteor.users.find().count()} members x $${
                      tier.monthly.price * 1
                    }/mo) = $${
                      Meteor.users.find().count() * (tier.monthly.price * 1)
                    }/mo`}
              </b>
            </Typography>
          ) : (
            <div>
              {pricingPeriod === 'year' && tier._id !== 'free' && (
                <>(${tier.yearly.price * 12}/yr)</>
              )}
            </div>
          )
        ) : pricingPeriod === 'year' && tier.yearly.price > 0 ? (
          <>
            &nbsp;&nbsp;
            <Typography variant="body2" color="textSecondary">
              (${tier.yearly.price * 12}/yr)
            </Typography>
          </>
        ) : (
          <div />
        )}
      </Box>
    </Grid>
  )
}

PriceBox.propTypes = {
  tier: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    monthly: PropTypes.shape({
      price: PropTypes.number,
    }).isRequired,
    yearly: PropTypes.shape({
      price: PropTypes.number,
    }).isRequired,
  }).isRequired,
  pricingLocale: PropTypes.string.isRequired,
  pricingPeriod: PropTypes.string.isRequired,
}

export default function Payment() {
  const classes = useStyles()
  const history = useHistory()
  const dispatch = useDispatch()
  const paymentOpen = useSelector((state) => state.paymentOpen || false)
  const paymentMessage = useSelector((state) => state.paymentMessage)
  const paymentFocus = useSelector((state) => state.paymentFocus)
  const paymentEmphasis = useSelector((state) => state.paymentEmphasis)
  const [pricingPeriod, setPeriod] = React.useState('year')
  const [pricingLocale, setLocale] = React.useState('hosted')
  const theme = useTheme()
  let supportShowing = false

  const handleClose = () => {
    dispatch({
      type: 'payment',
      paymentOpen: false,
    })
  }

  const handlePlan = async (tier) => {
    if (tier._id === 'free') {
      dispatch({
        type: 'payment',
        paymentOpen: false,
      })
    } else if (!Meteor.user().orgId && ['team'].includes(tier._id)) {
      const result = await confirmService.show({
        theme,
        title: `Create a team first...`,
        message: 'Before upgrading to team pro, please set up your team!',
        actionItems: [
          { label: 'Create my team', return: true },
          { label: 'Choose a different plan', return: false },
        ],
      })
      if (result) {
        dispatch({
          type: 'payment',
          paymentOpen: false,
        })
        history.push('/team')
      }
    } else if (['solo', 'team'].includes(tier._id)) {
      const stripe = Stripe(Meteor.settings.public.stripePublicKey)
      const priceId =
        pricingPeriod === 'year' ? tier.yearly.priceId : tier.monthly.priceId
      const data = await promisify(
        Meteor.call,
        CONSTANTS.methods.stripe.createSession,
        { priceId, type: 'checkout' }
      )
      stripe.redirectToCheckout({
        sessionId: data.id,
      })
    } else {
      // contact us form
      switch (tier._id) {
        // case "community_edition": {
        //   window.location.href = "https://github.com/Slatebox/slatebox-community";
        //   break;
        // }
        case 'community_edition':
        case 'bronze':
        case 'silver':
        case 'gold': {
          if (!supportShowing) {
            supportShowing = true
            window.$chatwoot.toggle()
          }
          break
        }
        default:
          break
      }
    }
  }

  let saasTiers = []
  let selfHostedTiers = []
  useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.pricingTiers)
    saasTiers = PricingTiers.find({ type: 'saas' }).fetch()
    if (Meteor.user() && Meteor.user().orgId) {
      // remove the solo option -- they've already created a team
      // the solo option is available PRIOR to creating the org
      saasTiers = saasTiers.filter((s) => !s.isSolo)
    }
    selfHostedTiers = PricingTiers.find({ type: 'self-hosted' }).fetch()
    const gold = selfHostedTiers.find((sh) => sh._id === 'gold')
    if (gold) {
      gold.subheader = (
        <>
          <span>Includes Slatebox Cloud</span>{' '}
          <Tooltip
            color="info"
            placement="top"
            title={
              <Typography
                component="div"
                style={{ color: '#fff' }}
                variant="body2"
              >
                Centrally store your slates in the cloud for access from all
                on-prem locations
              </Typography>
            }
          >
            <InfoIcon fontSize="small" />
          </Tooltip>
        </>
      )
    }
  })

  const billExplain1 =
    pricingLocale === 'hosted'
      ? 'Prices are per user, per month. '
      : 'Self-hosted plans are only available as annual subscriptions per server. Unlimited users.'
  const billExplain2 =
    pricingPeriod === 'month'
      ? 'Billed monthly.'
      : pricingLocale === 'hosted'
      ? 'Billed annually.'
      : ''
  const comingSoon =
    pricingLocale === 'hosted'
      ? ''
      : "(These plans are coming soon -- please reach out if you're interested)"
  // const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog
      fullScreen
      open={paymentOpen}
      onClose={handleClose}
      TransitionComponent={Transition}
      PaperProps={{ style: { backgroundColor: '#333', opacity: 0.95 } }}
    >
      <AppBar className={classes.appBar}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={handleClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" className={classes.title}>
            Level Up With Slatebox
          </Typography>
          <Typography variant="body2">{paymentMessage}</Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" component="main" className={classes.heroContent}>
        <Grid container spacing={2} justify="center" alignItems="center">
          <Grid item xs={12}>
            <Typography
              component="h1"
              variant="h2"
              align="center"
              color="secondary"
              gutterBottom
            >
              Pricing
            </Typography>
            <Typography
              variant="h5"
              align="center"
              color="textSecondary"
              component="p"
            >
              Want{' '}
              {paymentFocus ? (
                <span className={classes.focused}>{paymentFocus}</span>
              ) : (
                <span>more</span>
              )}
              ?{' '}
              {paymentEmphasis || (
                <>
                  Create private slates and enable real-time team collaboration
                  below.
                </>
              )}
            </Typography>
          </Grid>
          <Grid item>
            <ToggleButtonGroup
              value={pricingPeriod}
              exclusive
              onChange={(e, val) => {
                if (val.length) {
                  setPeriod(val)
                }
              }}
              aria-label="Slatebox Pricing Period"
            >
              <ToggleButton value="year" aria-label="left aligned">
                <Grid container>
                  <Grid item xs={12}>
                    <Typography variant="h6">Annually</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography color="secondary">
                      <b>Save 28%</b>
                    </Typography>
                  </Grid>
                </Grid>
              </ToggleButton>
              {pricingLocale === 'onprem' ? (
                <ToggleButton value="month" aria-label="left aligned" disabled>
                  <Grid container>
                    <Grid item xs={12}>
                      <Typography variant="h6">Monthly</Typography>
                    </Grid>
                    <Grid item xs={12} />
                  </Grid>
                </ToggleButton>
              ) : (
                <ToggleButton value="month" aria-label="left aligned">
                  <Grid container>
                    <Grid item xs={12}>
                      <Typography variant="h6">Monthly</Typography>
                    </Grid>
                    <Grid item xs={12} />
                  </Grid>
                </ToggleButton>
              )}
            </ToggleButtonGroup>
          </Grid>
          <Grid item>
            <ToggleButtonGroup
              value={pricingLocale}
              exclusive
              onChange={(e, val) => {
                if (val.length) {
                  setLocale(val)
                  if (val === 'onprem') {
                    setPeriod('year')
                  }
                }
              }}
              aria-label="Slatebox Pricing Locale"
            >
              <ToggleButton value="hosted" aria-label="left aligned">
                <Grid container>
                  <Grid item xs={12}>
                    <Typography variant="h6">Slatebox.com</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2">
                      Quick &amp; Fast Hosting
                    </Typography>
                  </Grid>
                </Grid>
              </ToggleButton>
              <ToggleButton value="onprem" aria-label="left aligned">
                <Grid container>
                  <Grid item xs={12}>
                    <Typography variant="h6">Self Hosted</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2">
                      Open Source &amp; On Premises
                    </Typography>
                  </Grid>
                </Grid>
              </ToggleButton>
            </ToggleButtonGroup>
          </Grid>
          <Grid item xs={12}>
            <Typography
              variant="h5"
              align="center"
              color="textSecondary"
              component="p"
            >
              {billExplain1} {billExplain2}
            </Typography>
            <Typography
              variant="h5"
              align="center"
              color="secondary"
              component="p"
            >
              {comingSoon}
            </Typography>
          </Grid>
        </Grid>
      </Container>
      <Container maxWidth="lg" component="main">
        {pricingLocale === 'hosted' ? (
          <Grid container spacing={5} justify="center" alignItems="center">
            {saasTiers.map((tier) => (
              // Enterprise card is full width at sm breakpoint
              <Grid
                item
                key={tier.title}
                xs={12}
                sm={tier.title === 'Enterprise' ? 12 : 6}
                md={3}
              >
                <Card>
                  <CardHeader
                    title={tier.title}
                    subheader={tier.subheader}
                    titleTypographyProps={{ align: 'center' }}
                    subheaderTypographyProps={{ align: 'center' }}
                    action={tier.hasStar ? <StarIcon /> : null}
                    className={classes.cardHeader}
                  />
                  <CardContent className={classes.cardContent}>
                    <div className={classes.cardPricing}>
                      {tier.title === 'Enterprise' ? (
                        <Typography
                          component="h2"
                          variant="h3"
                          color="textPrimary"
                        >
                          Custom
                        </Typography>
                      ) : (
                        <PriceBox
                          tier={tier}
                          pricingPeriod={pricingPeriod}
                          pricingLocale={pricingLocale}
                        />
                      )}
                    </div>
                    {tier.description.map((line) => (
                      <Typography
                        component="div"
                        variant="subtitle1"
                        align="center"
                        key={line}
                      >
                        {line}
                      </Typography>
                    ))}
                  </CardContent>
                  <CardActions>
                    <Button
                      fullWidth
                      variant={tier.buttonVariant}
                      color="primary"
                      onClick={(e) => {
                        handlePlan(tier)
                      }}
                      style={{ color: '#fff' }}
                    >
                      {tier.buttonText}
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Grid container spacing={5} justify="center" alignItems="center">
            {selfHostedTiers.map((tier) => (
              // Enterprise card is full width at sm breakpoint
              <Grid
                item
                key={tier.title}
                xs={12}
                sm={tier.title === 'Enterprise' ? 12 : 6}
                md={3}
              >
                <Card>
                  <CardHeader
                    title={tier.title}
                    subheader={tier.subheader}
                    titleTypographyProps={{ align: 'center' }}
                    subheaderTypographyProps={{ align: 'center' }}
                    action={tier.hasStar ? <StarIcon /> : null}
                    className={classes.cardHeader}
                  />
                  <CardContent className={classes.cardContent}>
                    <div className={classes.cardPricing}>
                      {tier.title === 'Enterprise' ? (
                        <Typography
                          component="h2"
                          variant="h3"
                          color="textPrimary"
                        >
                          Custom
                        </Typography>
                      ) : (
                        <PriceBox
                          tier={tier}
                          pricingPeriod={pricingPeriod}
                          pricingLocale={pricingLocale}
                        />
                      )}
                    </div>
                    {tier.description.map((line) => (
                      <Typography
                        component="div"
                        variant="subtitle1"
                        align="center"
                        key={line}
                      >
                        {line}
                      </Typography>
                    ))}
                  </CardContent>
                  <CardActions>
                    <Button
                      fullWidth
                      variant={tier.buttonVariant}
                      color="primary"
                      onClick={(e) => {
                        handlePlan(tier)
                      }}
                      style={{ color: '#fff' }}
                    >
                      {tier.buttonText}
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Container>
    </Dialog>
  )
}
