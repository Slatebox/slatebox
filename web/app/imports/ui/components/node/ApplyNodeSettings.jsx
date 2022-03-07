/* eslint-disable react/jsx-no-bind */
/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import DialogContent from '@material-ui/core/DialogContent'
import MuiDialogTitle from '@material-ui/core/DialogTitle'
import cloneDeep from 'lodash.clonedeep'
import Dialog from '@material-ui/core/Dialog'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import Checkbox from '@material-ui/core/Checkbox'
import ListItemText from '@material-ui/core/ListItemText'
import Typography from '@material-ui/core/Typography'
import Grid from '@material-ui/core/Grid'
import Button from '@material-ui/core/Button'
import IconButton from '@material-ui/core/IconButton'
import CloseIcon from '@material-ui/icons/Close'
import { withStyles } from '@material-ui/core/styles'
import defaultBehaviors from './defaultBehaviors'
import CONSTANTS from '../../../api/common/constants'
import { Slatebox, utils } from 'slatebox'
import promisify from '../../../api/client/promisify'
import nodeProps from '../../propTypes/nodeProps'

const styles = (theme) => ({
  root: {
    margin: 0,
    padding: theme.spacing(2),
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.grey[500],
  },
})

export default function ApplyNodeSettings({ node, onDialogClosed, open }) {
  const behaviors = defaultBehaviors()
  let allOtherNodeIds = []

  const possibleStyles = [
    {
      style: 'color',
      title: 'Node Color',
      description: 'Apply node color and opacity',
    },
    {
      style: 'relationships',
      title: 'Node Relationshps',
      description: 'Apply line color, opacity, and effect',
    },
    {
      style: 'border',
      title: 'Node Border',
      description: 'Apply border color, style, and opacity',
    },
    {
      style: 'text',
      title: 'Node Text',
      description: 'Apply font, size, color, opacity, and effect',
    },
    { style: 'shape', title: 'Node Shape', description: 'Apply node shape' },
    { style: 'image', title: 'Node Image', description: 'Apply node image' },
    { style: 'effect', title: 'Node Effect', description: 'Apply node effect' },
    {
      style: 'behavior',
      title: 'Node Behavior',
      description: 'Apply node behaviors',
    },
  ]

  const [applicableStyles, setApplicableStyles] = React.useState([])

  const addStyle = (style) => {
    let copy = cloneDeep(applicableStyles)
    if (copy.includes(style)) {
      copy = copy.filter((c) => c !== style)
    } else {
      copy.push(style)
    }
    setApplicableStyles(copy)
  }

  function closeApplyNodeSettingsDialog() {
    onDialogClosed()
  }

  function exe(pkg) {
    // local
    node?.slate.collab.invoke(pkg)
    // remote
    node?.slate.collab.send(pkg)
  }

  function invoke(opts) {
    allOtherNodeIds.forEach((nid) => {
      opts.packages.forEach((p) => {
        let c = true
        if (opts.compare) {
          const nn = node.slate.nodes.allNodes.find((n) => n.options.id === nid)
          c = opts.compare(nn)
        }
        if (c) {
          exe({ type: opts.type, data: { id: nid, ...p } })
        }
      })
    })
  }

  function getOtherNodes() {
    return node?.slate?.nodes.allNodes
      .filter((n) => {
        const eligible = n.options.id !== node?.options.id
        if (eligible) {
          if (node?.slate?.options.eligibleForThemeCompilation) {
            return (
              n.options.id === 'parent' || n.options.id.indexOf('child_') > -1
            )
          }
          return true
        }
        return false
      })
      .map((n) => n.options.id)
  }

  async function invokePathChanges() {
    const options = node?.options

    // neutralize the path position in prep for sending to other nodes
    const sendPath = Slatebox.utils._transformPath(
      options.vectorPath,
      `T${options.xPos * -1},${options.yPos * -1}`
    )

    // next calculate the specific paths for each node on the canvas
    const nodes = node?.slate.nodes.allNodes.filter((n) =>
      getOtherNodes().includes(n.options.id)
    )
    // eslint-disable-next-line no-restricted-syntax
    for (const nn of nodes) {
      const vbbox = Slatebox.utils.getBBox({ path: sendPath })
      // eslint-disable-next-line no-await-in-loop
      const path = await promisify(
        Meteor.call,
        CONSTANTS.methods.slates.scale,
        {
          path: sendPath,
          width: nn.options.width / vbbox.width,
          height: nn.options.height / vbbox.height,
        }
      )
      exe({
        type: 'onNodeShapeChanged',
        data: {
          id: nn.options.id,
          shape: path,
          width: vbbox.width,
          height: vbbox.height,
        },
      })
      // eslint-disable-next-line no-await-in-loop
      await utils.pause(200)
    }
  }

  function handleApply() {
    allOtherNodeIds = getOtherNodes()
    // node?.slate.collab
    const options = node?.options
    applicableStyles.forEach((style) => {
      switch (style) {
        case 'shape': {
          invokePathChanges()
          break
        }
        case 'behavior': {
          invoke({
            type: 'onNodeBehaviorChanged',
            packages: [
              {
                behaviorChanges: Object.keys(behaviors).map((b) => ({
                  name: b,
                  value: options[b],
                })),
              },
            ],
          })
          break
        }
        case 'color': {
          invoke({
            type: 'onNodeColorChanged',
            packages: [
              { color: options.backgroundColor, opacity: options.opacity },
            ],
            compare: (nn) =>
              nn.options.backgroundColor !== options.backgroundColor ||
              nn.options.opacity !== options.opacity,
          })
          break
        }
        case 'relationships': {
          // this doesn't fit with the invoke method
          const nodes = node?.slate.nodes.allNodes.filter((n) =>
            allOtherNodeIds.includes(n.options.id)
          )
          nodes.forEach((nn) => {
            const nid = nn.options.id
            nn.relationships.associations.forEach((a, ind) => {
              if (nn.options.lineColor !== options.lineColor) {
                exe({
                  type: 'onLineColorChanged',
                  data: { id: nid, color: options.lineColor },
                })
              }
              if (nn.options.lineOpacity !== options.lineOpacity) {
                exe({
                  type: 'onLinePropertiesChanged',
                  data: {
                    id: nid,
                    prop: 'lineOpacity',
                    val: options.lineOpacity,
                    associationId: a.id,
                    index: ind,
                  },
                })
              }
              if (nn.options.lineEffect !== options.lineEffect) {
                exe({
                  type: 'onLinePropertiesChanged',
                  data: {
                    id: nid,
                    prop: 'lineEffect',
                    val: options.lineEffect,
                    associationId: a.id,
                    index: ind,
                  },
                })
              }
              if (nn.options.lineWidth !== options.lineWidth) {
                exe({
                  type: 'onLinePropertiesChanged',
                  data: {
                    id: nid,
                    prop: 'lineWidth',
                    val: options.lineWidth,
                    associationId: a.id,
                    index: ind,
                  },
                })
              }
            })
          })
          break
        }
        case 'border': {
          invoke({
            type: 'onNodeBorderPropertiesChanged',
            packages: [
              { prop: 'borderColor', val: options.borderColor },
              { prop: 'borderOpacity', val: options.borderOpacity },
              { prop: 'borderStyle', val: options.borderStyle },
              { prop: 'borderWidth', val: options.borderWidth },
            ],
            compare: (nn) =>
              nn.options.borderColor !== options.borderColor ||
              nn.options.borderOpacity !== options.borderOpacity ||
              nn.options.borderStyle !== options.borderStyle ||
              nn.options.borderWidth !== options.borderWidth,
          })
          break
        }
        case 'text': {
          invoke({
            type: 'onNodeTextChanged',
            packages: [
              {
                fontSize: options.fontSize,
                fontFamily: options.fontFamily,
                fontColor: options.foregroundColor,
                textOpacity: options.textOpacity,
              },
            ],
          })
          invoke({
            type: 'onNodeEffectChanged',
            packages: [{ filter: { apply: 'text', id: options.filters.text } }],
            compare: (nn) => nn.options.filters.text !== options.filters.text,
          })
          break
        }
        case 'image': {
          invoke({
            type: 'onNodeImageChanged',
            packages: [
              {
                img: options.image,
                w: options.origImage.w,
                h: options.origImage.h,
              },
            ],
            compare: (nn) => nn?.options.image !== options.image,
          })
          break
        }
        case 'effect': {
          invoke({
            type: 'onNodeEffectChanged',
            packages: [{ filter: { apply: 'vect', id: options.filters.vect } }],
            compare: (nn) => nn.options.filters.vect !== options.filters.vect,
          })
          break
        }
        default:
          break
      }
    })
    // close after applying
    onDialogClosed()
  }

  ApplyNodeSettings.propTypes = {
    onDialogClosed: PropTypes.func.isRequired,
    node: nodeProps,
  }

  ApplyNodeSettings.defaultProps = {
    node: null,
  }

  const DialogTitle = withStyles(styles)((props) => {
    // eslint-disable-next-line react/prop-types
    const { children, classes, onClose, ...other } = props
    return (
      // eslint-disable-next-line react/jsx-props-no-spreading
      <MuiDialogTitle disableTypography className={classes.root} {...other}>
        <Typography variant="h6" color="secondary">
          {children}
        </Typography>
        {onClose ? (
          <IconButton
            aria-label="close"
            className={classes.closeButton}
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        ) : null}
      </MuiDialogTitle>
    )
  })

  return (
    <Dialog
      maxWidth="md"
      fullWidth
      onClose={closeApplyNodeSettingsDialog}
      aria-labelledby="node-custom-behavior-dialog"
      open={open}
      PaperProps={{
        style: {
          opacity: '0.93',
        },
      }}
    >
      <DialogContent style={{ minHeight: '300px' }}>
        <DialogTitle
          id="custom-node-behavior"
          onClose={closeApplyNodeSettingsDialog}
        >
          Apply Node Settings
          <Typography variant="body2">
            Select which style(s) to globally apply to all the other nodes on
            this slate.
          </Typography>
        </DialogTitle>
        <Grid container justify="flex-end" alignItems="center">
          {possibleStyles.map((n) => (
            <Grid item key={n} xs={6}>
              <List>
                <ListItem
                  dense
                  role={undefined}
                  button
                  onClick={() => {
                    addStyle(n.style)
                  }}
                >
                  <ListItemIcon>
                    <Checkbox
                      edge="start"
                      checked={applicableStyles.includes(n.style)}
                      tabIndex={-1}
                      disableRipple
                      inputProps={{ 'aria-labelledby': `label-0` }}
                    />
                  </ListItemIcon>
                  <ListItemText primary={n.title} secondary={n.description} />
                </ListItem>
              </List>
            </Grid>
          ))}
          <Grid item>
            <Button variant="outlined" color="secondary" onClick={handleApply}>
              Apply
            </Button>
          </Grid>
        </Grid>
      </DialogContent>
    </Dialog>
  )
}
