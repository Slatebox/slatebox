import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTheme, withStyles } from '@material-ui/core/styles'
import cloneDeep from 'lodash.clonedeep'
import useMediaQuery from '@material-ui/core/useMediaQuery'
import Dialog from '@material-ui/core/Dialog'
import CloseIcon from '@material-ui/icons/Close'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import Checkbox from '@material-ui/core/Checkbox'
import ListItemText from '@material-ui/core/ListItemText'
import Typography from '@material-ui/core/Typography'
import Grid from '@material-ui/core/Grid'
import IconButton from '@material-ui/core/IconButton'
import MuiDialogTitle from '@material-ui/core/DialogTitle'
import DialogContent from '@material-ui/core/DialogContent'
import Button from '@material-ui/core/Button'
import defaultBehaviors from './defaultBehaviors'
import { CONSTANTS } from '../../../api/common/constants'
import { Slatebox } from '../../../api/client/slatebox'
import { promisify } from '../../../api/client/promisify'
import utils from '../../../api/client/slatebox/helpers/Utils'

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

export const ApplyNodeSettings = (props) => {
  const theme = useTheme()
  const matches = useMediaQuery(theme.breakpoints.up('md'))
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
    props.onDialogClosed()
  }

  function exe(pkg) {
    // local
    props?.node?.slate.collab.invoke(pkg)
    // remote
    props?.node?.slate.collab.send(pkg)
  }

  function invoke(opts) {
    allOtherNodeIds.forEach((nid) => {
      opts.packages.forEach((p) => {
        let c = true
        if (opts.compare) {
          const node = props.node.slate.nodes.allNodes.find(
            (n) => n.options.id === nid
          )
          c = opts.compare(node)
        }
        if (c) {
          exe({ type: opts.type, data: { id: nid, ...p } })
        }
      })
    })
  }

  function getOtherNodes() {
    return props?.node?.slate?.nodes.allNodes
      .filter((n) => {
        let eligible = n.options.id !== props?.node?.options.id
        if (eligible) {
          if (props?.node?.slate?.options.eligibleForThemeCompilation) {
            return (
              n.options.id === 'parent' || n.options.id.indexOf('child_') > -1
            )
          } else {
            return true
          }
        }
        return false
      })
      .map((n) => n.options.id)
  }

  async function invokePathChanges() {
    const options = props?.node?.options

    // neutralize the path position in prep for sending to other nodes
    const sendPath = Slatebox.Utils.lowLevelTransformPath(
      options.vectorPath,
      `T${options.xPos * -1},${options.yPos * -1}`
    )

    // next calculate the specific paths for each node on the canvas
    const nodes = props?.node?.slate.nodes.allNodes.filter((n) =>
      getOtherNodes().includes(n.options.id)
    )
    for (let node of nodes) {
      let vbbox = Slatebox.utils.getBBox({ path: sendPath })
      let path = await promisify(Meteor.call, CONSTANTS.methods.slates.scale, {
        path: sendPath,
        width: node.options.width / vbbox.width,
        height: node.options.height / vbbox.height,
      })
      exe({
        type: 'onNodeShapeChanged',
        data: {
          id: node.options.id,
          shape: path,
          width: vbbox.width,
          height: vbbox.height,
        },
      })
      await utils.pause(200)
    }
  }

  function handleApply() {
    allOtherNodeIds = getOtherNodes()
    // props?.node?.slate.collab
    const options = props?.node?.options
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
                behaviorChanges: Object.keys(behaviors).map((b) => {
                  return {
                    name: b,
                    value: options[b],
                  }
                }),
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
            compare: (node) => {
              return (
                node.options.backgroundColor !== options.backgroundColor ||
                node.options.opacity !== options.opacity
              )
            },
          })
          break
        }
        case 'relationships': {
          // this doesn't fit with the invoke method
          const nodes = props?.node?.slate.nodes.allNodes.filter((n) =>
            allOtherNodeIds.includes(n.options.id)
          )
          nodes.forEach((node) => {
            const nid = node.options.id
            node.relationships.associations.forEach((a, ind) => {
              if (node.options.lineColor !== options.lineColor) {
                exe({
                  type: 'onLineColorChanged',
                  data: { id: nid, color: options.lineColor },
                })
              }
              if (node.options.lineOpacity !== options.lineOpacity) {
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
              if (node.options.lineEffect !== options.lineEffect) {
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
              if (node.options.lineWidth !== options.lineWidth) {
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
            compare: (node) => {
              return (
                node.options.borderColor !== options.borderColor ||
                node.options.borderOpacity !== options.borderOpacity ||
                node.options.borderStyle !== options.borderStyle ||
                node.options.borderWidth !== options.borderWidth
              )
            },
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
            compare: (node) => {
              return node.options.filters.text !== options.filters.text
            },
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
            compare: (node) => {
              return node?.options.image !== options.image
            },
          })
          break
        }
        case 'effect': {
          invoke({
            type: 'onNodeEffectChanged',
            packages: [{ filter: { apply: 'vect', id: options.filters.vect } }],
            compare: (node) => {
              return node.options.filters.vect !== options.filters.vect
            },
          })
          break
        }
      }
    })
    // close after applying
    props.onDialogClosed()
  }

  const DialogTitle = withStyles(styles)((props) => {
    const { children, classes, onClose, ...other } = props
    return (
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
      fullWidth={true}
      onClose={closeApplyNodeSettingsDialog}
      aria-labelledby="node-custom-behavior-dialog"
      open={props.open}
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
          {possibleStyles.map((n, i) => (
            <Grid item key={i} xs={6}>
              <List>
                <ListItem
                  dense
                  role={undefined}
                  button
                  onClick={(e) => {
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
