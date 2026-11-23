import React from 'react'
// import { Meteor } from 'meteor/meteor'
// import { useAtom } from 'jotai'
import { PropTypes } from 'prop-types'
import Grid from '@mui/material/Grid2'
import Button from '@mui/material/Button'
// import Tooltip from '@mui/material/Tooltip'
// import ToggleButtonGroup from '@mui/lab/ToggleButtonGroup'
// import Switch from '@mui/material/Switch'
// import ToggleButton from '@mui/lab/ToggleButton'
import Typography from '@mui/material/Typography'
// import CONSTANTS from '../../../api/common/constants'
import slateProps from '../../propTypes/slateProps'
// import { createSlateWithAIContent } from '../../jotai/atoms'

/*
Use this to update a test slate with coords in mongo
var s = db.slates.findOne({ shareId: "a0b2fe9e" }); s.nodes.forEach((n, i) => { print('will update', n.options.id); var ind = db.slates.findOne({ shareId: "a0b2fe9e" }).nodes.findIndex(nx => nx.options.id === n.options.id); print('ind is', ind); db.slates.update({ shareId: "a0b2fe9e" }, { $set: { [`nodes.${ind}.options.text`]: `${n.options.id}\n${n.options.xPos.toFixed(2)}, ${n.options.yPos.toFixed(2)}\n${n.options.width.toFixed(2)}, ${n.options.height.toFixed(2)}` } }) })
*/

export default function SlateLayout({ slate, onChange }) {
  // const layoutType = slate?.options?.layoutType || { val: 'free' }
  // console.log('current layout', layoutType)
  // const [currentLayout, setCurrentLayout] = React.useState(layoutType)
  // const [currentAIContext, setCurrentAIContext] = useAtom(
  //   createSlateWithAIContent
  // )
  // const disableAutoLayoutOfManuallyPositionedNodes =
  //   slate?.options?.disableAutoLayoutOfManuallyPositionedNodes ?? false
  // const [currentManualPosition, setManualPosition] = React.useState(
  //   disableAutoLayoutOfManuallyPositionedNodes
  // )

  // const LAYOUTS = [
  //   {
  //     name: 'None',
  //     val: 'free',
  //     description: 'No layout applied',
  //   },
  //   {
  //     name: 'AI',
  //     val: 'ai',
  //     description: 'Auto layout using AI',
  //   },
  //   {
  //     name: 'Top -> Bottom',
  //     val: 'dot',
  //     overlap: 'compress',
  //     rankdir: 'TB',
  //     description: 'Flow nodes from top to the bottom',
  //   },
  //   {
  //     name: 'Bottom -> Top',
  //     val: 'dot-bt',
  //     sendVal: 'dot',
  //     overlap: 'compress',
  //     rankdir: 'BT',
  //     description: 'Flow nodes from bottom to the top',
  //   },
  //   {
  //     name: 'Left -> Right',
  //     val: 'dot-lr',
  //     sendVal: 'dot',
  //     overlap: 'compress',
  //     rankdir: 'LR',
  //     description: 'Flow nodes from left to the right',
  //   },
  //   {
  //     name: 'Right -> Left',
  //     val: 'dot-rl',
  //     sendVal: 'dot',
  //     overlap: 'compress',
  //     rankdir: 'RL',
  //     description: 'Flow nodes from right to the left',
  //   },
  //   // {
  //   //   name: 'Circular',
  //   //   val: 'twopi',
  //   //   overlap: 'scalexy',
  //   //   description: 'Apply a circular diagram',
  //   // },
  //   {
  //     name: 'Circle',
  //     val: 'twopi',
  //     overlap: 'scalexy',
  //     description: 'Apply a circular diagram',
  //   },
  //   {
  //     name: 'Circle2',
  //     val: 'neato',
  //     overlap: 'scalexy',
  //     description: 'Apply a different circular diagram',
  //   },
  //   // {
  //   //   name: 'Circular',
  //   //   val: 'circo',
  //   //   overlap: 'compress',
  //   //   description: 'Apply a circular layout',
  //   // },
  //   // {
  //   //   name: 'Springy',
  //   //   val: 'fdp',
  //   //   overlap: 'scalexy',
  //   //   description: 'Apply a springy mindmap layout',
  //   // },
  //   // {
  //   //   name: 'Large Springy',
  //   //   val: 'sfdp',
  //   //   description: 'Larger and spingier',
  //   // },
  //   // {
  //   //   name: 'Boxy',
  //   //   val: 'osage',
  //   //   overlap: 'compress',
  //   //   description: 'Apply a boxy grid layout',
  //   // }
  // ]

  // const handleManualPosition = (e) => {
  //   setManualPosition(e.target.checked)
  //   onChange({
  //     type: 'onSlateLayoutTypeChanged',
  //     data: {
  //       disableAutoLayoutOfManuallyPositionedNodes: e.target.checked,
  //     },
  //   })
  // }

  // The engine's tidy layout (arrange_nodes "tidy" for an agent): no note is
  // left on another, locked notes stay put, and the move is saved.
  const optimizeLayout = () => {
    slate.removeLayoutOverlaps()
  }

  // const setLayout = async (event, newLayout) => {
  //   // event.target.value
  //   // console.log('sending layout', currentLayout, newLayout)
  //   if (newLayout != null) {
  //     const newLayoutType = LAYOUTS.find((l) => l.val === newLayout)
  //     setCurrentLayout(newLayoutType)
  //     // const newAIContext = { ...currentAIContext, newLayoutType }
  //     // setCurrentAIContext(newAIContext)
  //     // await Slates.updateAsync(
  //     //   { _id: slate.options.id },
  //     //   {
  //     //     $set: {
  //     //       'options.ai.isConversation.newLayoutType': newLayoutType,
  //     //     },
  //     //   }
  //     // )
  //     newLayoutType.useQuandrants = slate?.options?.useLayoutQuandrants
  //     if (newLayout !== 'free') {
  //       if (newLayout === 'ai') {
  //         slate.removeLayoutOverlaps(true)
  //         return
  //       }

  //       // if (newLayoutType.ranksep === 'varies') {
  //       //   const multi = currentAIContext?.isConversation ? 5 : 6
  //       //   console.log('multi is', multi, currentAIContext?.isConversation)
  //       //   newLayoutType.ranksep = packageLayout.uniqueIds.length / multi
  //       //   console.log('newLayoutType.ranksep', newLayoutType)
  //       // }
  //       // const layout = await Meteor.callAsync(
  //       //   CONSTANTS.methods.layouts.calculate,
  //       //   {
  //       //     layoutType: {
  //       //       ...newLayoutType,
  //       //       val: newLayoutType.sendVal ?? newLayoutType.val,
  //       //     },
  //       //     packageLayout,
  //       //   }
  //       // )
  //       // console.log('Got layout', layout)
  //       /*
  //       "exportNodes": {
  //         "010C580B": {
  //           "x": "279.5",
  //           "y": "322"
  //         },
  //         "ad79211ead0a": {
  //           "x": "183.5",
  //           "y": "186"
  //         },
  //         "c2134651593b": {
  //           "x": "376.5",
  //           "y": "186"
  //         },
  //         "0bad6428b74a": {
  //           "x": "87.5",
  //           "y": "50"
  //         },
  //         "2aab8002c94c": {
  //           "x": "280.5",
  //           "y": "50"
  //         }
  //       }
  //       */
  //       slate?.nodes.applyLayout(layout)

  //       // const pkg = {
  //       //   type: 'onNodesMove',
  //       //   data: self.slate.nodes.nodeMovePackage({
  //       //     nodes: self.selectedNodes,
  //       //     relationships: self.relationshipsToTranslate.concat(
  //       //       self.relationshipsToRefresh
  //       //     ),
  //       //   }),
  //       // }

  //       // const mPkg = {
  //       //   dur: 500,
  //       //   moves: [
  //       //     {
  //       //       id: '*',
  //       //       x: s % 2 === 0 ? 20 : -20,
  //       //       y: s % 2 === 0 ? -20 : -20,
  //       //     },
  //       //   ],
  //       // }
  //       // const pkg = self.slate.nodes.nodeMovePackage(mPkg)
  //       // self.slate.nodes.moveNodes(pkg, {
  //       //   animate: true,
  //       //   cb: () => {
  //       //     setTimeout(() => {
  //       //       move()
  //       //     }, 4000)
  //       //   },
  //       // })

  //       // const pkg = {
  //       //     type: 'onNodesMove',
  //       //     data: self.slate.nodes.nodeMovePackage({
  //       //       nodes: self.selectedNodes,
  //       //       relationships: self.relationshipsToTranslate.concat(
  //       //         self.relationshipsToRefresh
  //       //       ),
  //       //     }),
  //       //   }

  //       //   self.slate.collab?.send(pkg)
  //       //   self.slate.birdsEye?.nodeChanged(pkg)
  //       // }
  //     }

  //     onChange({
  //       type: 'onSlateLayoutTypeChanged',
  //       data: {
  //         layoutType: newLayoutType,
  //       },
  //     })
  //   }
  // }

  SlateLayout.propTypes = {
    slate: slateProps,
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Grid
      container
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
    >
      <Grid>
        <Typography variant="body2">
          Note this will optimize the layout of this slate and reposition your
          nodes.
        </Typography>
      </Grid>
      <Grid>
        <Button
          variant="contained"
          size="large"
          color="secondary"
          onClick={optimizeLayout}
        >
          Optimize Layout
        </Button>
      </Grid>
      {/* <Grid size={6}>
        Do not auto-layout explicitly moved nodes
      </Grid>
      <Grid size={6}>
        <Tooltip
          title="When disabled, nodes that you manually position will be repositioned when auto layout runs."
          placement="top"
          aria-label="autoResizeNodesBasedOnText"
        >
          <Switch
            onChange={handleManualPosition}
            checked={currentManualPosition}
          />
        </Tooltip>
      </Grid> */}
    </Grid>
  )
}
