/* eslint-disable no-nested-ternary */
/* eslint-disable no-underscore-dangle */
import React, { useEffect, forwardRef } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useAtom } from 'jotai'
import { useLocation } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import AppBar from '@mui/material/AppBar'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Grid from '@mui/material/Grid2'
import StarIcon from '@mui/icons-material/StarBorder'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Container from '@mui/material/Container'
import Box from '@mui/material/Box'
import Slide from '@mui/material/Slide'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import ThumbUpOutlined from '@mui/icons-material/ThumbUpOutlined'
import ThumbDownOutlined from '@mui/icons-material/ThumbDownOutlined'
import ThumbUpAltSharp from '@mui/icons-material/ThumbUpAltSharp'
import ThumbDownAltSharp from '@mui/icons-material/ThumbDownAltSharp'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import { useTheme } from '@mui/material/styles'
import Tooltip from '@mui/material/Tooltip'
import InfoIcon from '@mui/icons-material/Info'
import CONSTANTS from '../../api/common/constants'
import promisify from '../../api/client/promisify'

import { globalMessage, videoGuideOpen } from '../jotai/atoms'

const Transition = React.forwardRef((props, ref) => (
  // eslint-disable-next-line react/jsx-props-no-spreading
  <Slide direction="up" ref={ref} {...props} />
))

export default function VideoHelpGuides() {
  const locale = useLocation()
  const [message, setMessage] = useAtom(globalMessage)
  const [isVideoHelpOpen, setVideoHelpOpen] = useAtom(videoGuideOpen)
  const [videoGuide, setVideoGuide] = React.useState({})
  const [like, setLike] = React.useState([])
  const [invokeRandom, setRandom] = React.useState()
  const theme = useTheme()

  const handleClose = () => {
    setVideoHelpOpen(false)
  }

  async function fetchVideoGuides() {
    const path =
      locale.pathname.length > 1
        ? `/${locale.pathname.split('/')[1]}`
        : locale.pathname
    const guide = await Meteor.callAsync(
      CONSTANTS.methods.videoHelpGuides.get,
      { path }
    )
    setVideoGuide(guide)
  }

  const fetchVideoGuideLikes = async () => {
    if (Meteor.user() && !Meteor.user().isAnonymous) {
      const results = await Meteor.callAsync(
        CONSTANTS.methods.videoHelpGuideLikes.get,
        { userId: Meteor.user()._id }
      )
      const likeDislike = {}
      for (let i = 0; i < results.length; i += 1) {
        likeDislike[results[i].videoId] = results[i].isLike
      }
      setLike(likeDislike)
    }
  }

  const setLikeDislike = async (arg, videoId, userId) => {
    const likeDislike = like
    likeDislike[videoId] = arg
    setLike(likeDislike)
    await Meteor.callAsync(CONSTANTS.methods.videoHelpGuideLikes.post, {
      videoId,
      userId,
      isLike: arg,
    })
    setRandom(Random.id())
  }

  useEffect(() => {
    fetchVideoGuides()
  }, [locale])

  useEffect(() => {
    if (like.length === 0) {
      fetchVideoGuideLikes()
    }
  }, [Meteor.user()])

  return (
    <Box
      sx={{
        '& .heroContent': {
          padding: (theme) => theme.spacing(8, 0, 6),
        },
        '& .cardHeader': {
          backgroundColor: (theme) => theme.palette.primary.main,
          color: (theme) => theme.palette.secondary.main,
        },
        '& .cardPricing': {
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'baseline',
          marginBottom: (theme) => theme.spacing(2),
        },
        '& .appBar': {
          position: 'relative',
        },
        '& .title': {
          marginLeft: (theme) => theme.spacing(2),
          flex: 1,
        },
        '& .focused': {
          color: (theme) => theme.palette.secondary.main,
        },
        '& .paymentSpacing': {
          padding: '10px',
        },
      }}
    >
      <Dialog
        fullScreen
        open={isVideoHelpOpen}
        onClose={handleClose}
        TransitionComponent={Transition}
        PaperProps={{ style: { backgroundColor: '#333', opacity: 0.95 } }}
      >
        <AppBar className="appBar">
          <Toolbar>
            <IconButton
              edge="start"
              color="inherit"
              onClick={handleClose}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
            <Typography variant="h6" className="title">
              How-To Guides
            </Typography>
            <Typography variant="body2">{videoGuide?.title}</Typography>
          </Toolbar>
        </AppBar>
        <Container maxWidth="lg" component="main" className="heroContent">
          <Grid
            container
            spacing={3}
            justifyContent="space-evenly"
            alignItems="center"
          >
            {videoGuide?.guides?.map((g) => (
              <React.Fragment key={g.id}>
                <Grid size={6}>
                  <iframe
                    width="100%"
                    height="400px"
                    src={`https://embed.app.guidde.com/playbooks/${g.id}`}
                    title={g.title}
                    frameBorder="0"
                    allow="fullscreen"
                  />
                  <Typography variant="h6" color="secondary">
                    {g.title}
                  </Typography>
                  {Meteor.user() && !Meteor.user().isAnonymous && (
                    <Box sx={{ display: 'flex' }}>
                      <Box padding={1}>
                        {like[g.id] ? (
                          <ThumbUpAltSharp
                            onClick={() =>
                              setLikeDislike(null, g.id, Meteor.user()._id)
                            }
                          />
                        ) : (
                          <ThumbUpOutlined
                            onClick={() =>
                              setLikeDislike(true, g.id, Meteor.user()._id)
                            }
                          />
                        )}
                      </Box>
                      <Box padding={1}>
                        {!like[g.id] ? (
                          <ThumbDownAltSharp
                            onClick={() =>
                              setLikeDislike(null, g.id, Meteor.user()._id)
                            }
                          />
                        ) : (
                          <ThumbDownOutlined
                            onClick={() =>
                              setLikeDislike(false, g.id, Meteor.user()._id)
                            }
                          />
                        )}
                      </Box>
                    </Box>
                  )}
                </Grid>
              </React.Fragment>
            ))}
          </Grid>
        </Container>
      </Dialog>
    </Box>
  )
}
