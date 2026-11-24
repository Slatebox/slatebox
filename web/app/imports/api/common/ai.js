/* eslint-disable no-nested-ternary */
/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */
/* eslint-disable import/prefer-default-export */
/* eslint-disable no-await-in-loop */
/* eslint-disable new-cap */
/* eslint-disable no-loop-func */
/* eslint-disable no-inner-declarations */
/* eslint-disable no-restricted-syntax */
import { Slatebox } from 'slateboxjs'
import { Random } from 'meteor/random'
import CONSTANTS from './constants'
import defaultShapes from '../../ui/components/node/defaultShapes'
import pathAtOrigin from '../../ui/components/node/pathAtOrigin'
import utils from './utils'

const groupColors = {}
let groupColorIndex = -1
async function createAIConversationNode(
  nodeToCreate,
  currentAIContext,
  slate,
  defaultLineColor,
  mainNodeId,
  isParent,
  templates,
  collaboratorInstanceId
) {
  let xPos = nodeToCreate.xPos
    ? slate.options.viewPort.left + nodeToCreate.xPos
    : 10000
  let yPos = nodeToCreate.yPos
    ? slate.options.viewPort.top + nodeToCreate.yPos
    : 10000

  // if this is a category positioned node, set its x, y to be within that category
  const catId = nodeToCreate.parentCategoryIds?.[0]?.replace('category_', '')
  const categ = currentAIContext?.templateCategories[catId]
  if (categ) {
    xPos = Slatebox.utils.randomInt(categ.left, categ.right - 200)
    yPos = Slatebox.utils.randomInt(categ.top, categ.bottom - 200)
  }

  const { isCategory, isUpdate, description } = nodeToCreate

  const text =
    description?.trim().replace(/\n/gi, ' ').length > 0
      ? Slatebox.utils
          .createMultiLineText(
            description?.trim().replace(/\n/gi, ' '),
            nodeToCreate.textLines ?? 6
          ) // nodeToCreate.textLines could be used here
          .trim()
      : ''

  const nodeExists = slate?.nodes.allNodes.find(
    (n) => n.options.id === nodeToCreate.id
  )

  const styleNode = nodeToCreate.styleNodeId
    ? slate?.nodes.allNodes.find(
        (n) => n.options.id === nodeToCreate.styleNodeId
      )
    : null

  if (isUpdate && !nodeExists) {
    // this should be caught in processConversation
    throw new Error(`You are attempting to update a node that does not exist`)
  }

  const aiShapes = defaultShapes.filter((d) => d.aiEligible && d.key === 'rect')
  const { groupId } = nodeToCreate // || 'mainGroup'

  if (!groupColors[groupId]) {
    groupColorIndex += 1
    if (groupColorIndex >= currentAIContext.palette.length) {
      groupColorIndex = 0
    }
    groupColors[groupId] = currentAIContext.palette[groupColorIndex]
  }

  const bgColor = nodeToCreate.color || groupColors[groupId]

  if (isUpdate && nodeExists) {
    if (
      nodeExists?.options?.text.trim().toLowerCase() !==
      text.trim().toLowerCase()
    ) {
      // currently the only supported update is to the node text
      // set the text
      const textPkg = {
        type: 'onNodeTextChanged',
        data: {
          id: nodeToCreate.id,
          instanceId: collaboratorInstanceId,
          text,
        },
      }
      // console.log('sending collab text pkg', textPkg)
      // , fontColor: _self._.options.foregroundColor, textXAlign: _self._.options.textXAlign, textYAlign: _self._.options.textYAlign
      slate?.collab.exe(textPkg)
    }

    if (
      nodeToCreate.image &&
      nodeExists?.options?.image !== nodeToCreate.image
    ) {
      // currently the only supported update is to the node text
      // set the text
      const imgPkg = {
        type: 'onNodeImageChanged',
        data: {
          img: nodeToCreate.image,
        },
      }
      // console.log('sending collab text pkg', imgPkg)
      // , fontColor: _self._.options.foregroundColor, textXAlign: _self._.options.textXAlign, textYAlign: _self._.options.textYAlign
      slate?.collab.exe(imgPkg)
    }

    if (nodeExists?.options?.backgroundColor.toLowerCase() !== bgColor) {
      const pkg = { id: nodeToCreate.id, color: bgColor }
      if (bgColor === 'transparent') {
        delete pkg.color
        pkg.opacity = 0
      }
      const colorPkg = {
        type: 'onNodeColorChanged',
        data: pkg,
      }
      // console.log('sending collab text pkg', textPkg)
      // , fontColor: _self._.options.foregroundColor, textXAlign: _self._.options.textXAlign, textYAlign: _self._.options.textYAlign
      slate?.collab.exe(colorPkg)
    }

    if (
      nodeExists?.options?.xPos !== xPos ||
      nodeExists?.options?.yPos !== yPos
    ) {
      const moveX = xPos - nodeExists.options.xPos
      const moveY = yPos - nodeExists.options.yPos
      // console.log('moving node', aiContent.category, text, moveX, moveY)
      const pkg = slate.nodes.nodeMovePackage({
        dur: 500,
        moves: [
          {
            id: nodeExists.options.id,
            x: moveX,
            y: moveY,
          },
        ],
      })
      slate.collab?.exe({
        type: 'onNodesMove',
        data: pkg,
      })
    }

    return
  }

  const fontSize =
    nodeToCreate.fontSize ||
    (styleNode?.options.fontSize ?? (isCategory ? '24' : '16'))
  const fontStyle =
    styleNode?.options.fontStyle ?? 'normal'
  const fontFamily =
    nodeToCreate.fontFamily ||
    (styleNode?.options.fontFamily ??
      (isCategory
        ? currentAIContext.titleFont || 'Roboto Sans'
        : currentAIContext.textFont || 'Roboto Sans'))

  const textDimens = Slatebox.utils.getTextWidth(
    text,
    `${fontSize}pt ${fontFamily}`
  )

  // const tPadding = 10
  // const width = parseInt(textDimens.width + tPadding, 10)
  // const height = parseInt(textDimens.height + tPadding, 10)
  let nodeWidth = nodeToCreate.width
  let nodeHeight = nodeToCreate.height
  let widthScalar = 1
  let heightScalar = 1
  const honorPathConstraints =
    nodeToCreate.nouns.length > 0 && !nodeToCreate.defaultShaped
  const usePath =
    nodeToCreate.nouns.length > 0
      ? nodeToCreate.nouns[0]
      : nodeToCreate.image
      ? defaultShapes.find((vx) => vx.key === 'rect').path
      : aiShapes[Slatebox.utils.randomInt(0, aiShapes.length - 1)].path

  if (!nodeWidth && honorPathConstraints) {
    const vectDimens = Slatebox.utils.getBBox({ path: usePath })
    const { transWidth, transHeight } =
      Slatebox.utils.obtainProportionateWidthAndHeightForResizing(
        0, // dx
        0, // dy
        textDimens.width, // currentVectWidth
        textDimens.height, // currentVectHeight
        vectDimens.width, // origVectWidth,
        vectDimens.height, // origVectHeight
        false, // isCtrl - would void proportionate
        true // isCustom
      )
    // console.log(
    //   'getting width',
    //   textDimens,
    //   vectDimens,
    //   transWidth,
    //   transHeight,
    //   nodeToCreate.nouns
    // )
    // nodeHeight = Math.max(textDimens.height, vectDimens.height)
    // nodeWidth = Math.max(textDimens.width, vectDimens.width)
    nodeHeight = transHeight
    nodeWidth = transWidth
  } else if (text?.length && !nodeToCreate.image) {
    //  && nodeToCreate.transparent
    const vectDimens = Slatebox.utils.getBBox({ path: usePath })
    widthScalar = textDimens.width / vectDimens.width
    heightScalar = textDimens.height / vectDimens.height
    nodeHeight = textDimens.height // Math.max(textDimens.height, vectDimens.height)
    nodeWidth = textDimens.width // Math.max(textDimens.width, vectDimens.width)
  }

  // Stored from its own origin, never in canvas coordinates (pathAtOrigin.js).
  const vectorPath = pathAtOrigin(
    Slatebox.utils._transformPath(usePath, `T${xPos},${yPos} s${widthScalar},${heightScalar}`)
  )
  /* isCategory
      ? Slatebox.utils._transformPath(usePath, `T${xPos},${yPos} s${widthScalar},${heightScalar}}`)
      : Slatebox.utils._transformPath(
          usePath,
          `T${xPos},${yPos} s${transWidth / 10},${transHeight / 10}`
        )
    */

  const baseOpts = {
    id: nodeToCreate.id,
    name: nodeToCreate.id,
    xPos,
    yPos,
    width: nodeWidth,
    height: nodeHeight,
    image: nodeToCreate.image,
    imageOrigWidth: nodeToCreate.imageOrigWidth,
    imageOrigHeight: nodeToCreate.imageOrigHeight,
    defaultShaped: nodeToCreate.defaultShaped,
    vectorPath, // aiContent.shape ||
    shapeHint: 'rectangle', // nodeToCreate.image ? 'custom' : 'rectangle', // custom enforces proportional resizing
    borderDisplayOnly: nodeToCreate.transparent && text?.length > 0,
    borderWidth: nodeToCreate.borderWidth ?? 1,
    borderStyle: nodeToCreate.borderStyle ?? 'solid',
    borderOpacity:
      nodeToCreate.opacity === 0
        ? 1
        : nodeToCreate.borderOpacity ??
          ((nodeToCreate.transparent && text?.length > 0) ||
          bgColor === 'transparent'
            ? 1
            : 0),
    opacity:
      nodeToCreate.opacity ??
      ((nodeToCreate.transparent && text?.length > 0) ||
      bgColor === 'transparent'
        ? 0
        : 1),
    rotate: {
      rotationAngle: nodeToCreate.rotationAngle ?? 0,
      point: {
        x: xPos + nodeWidth / 2,
        y: yPos + nodeHeight / 2,
      },
    },
    groupId,
    text,
  }

  const filters = {}

  if (nodeToCreate.filter) {
    if (text?.length > 0) {
      filters.text = nodeToCreate.filter
      if (nodeToCreate.filter === 'embossed') {
        nodeToCreate.foregroundColor = '#ffffff'
      }
    } else {
      filters.vect = nodeToCreate.filter
    }
  } else if (!nodeToCreate.transparent) {
    filters.vect = 'postItNote'
  }

  if (nodeToCreate.image && !filters.text && text?.length > 0) {
    filters.text = 'embossed'
    nodeToCreate.foregroundColor = '#ffffff'
  }

  const animations = {}
  if (nodeToCreate.animation) {
    if (text?.length > 0) {
      animations.text = nodeToCreate.animation
    } else {
      animations.vect = nodeToCreate.animation
    }
  }

  const nopts = styleNode
    ? {
        ...baseOpts,
        backgroundColor: bgColor,
        fontFamily,
        fontSize,
        foregroundColor: styleNode.options.foregroundColor,
        lineColor: styleNode.options.lineColor,
        lineWidth: styleNode.options.lineWidth,
        filters: styleNode.options.filters,
        animations: styleNode.options.animations,
      }
    : {
        ...baseOpts,
        backgroundColor: bgColor === 'transparent' ? '#fff' : bgColor,
        fontFamily,
        fontSize,
        foregroundColor:
          nodeToCreate.foregroundColor ||
          (nodeToCreate.transparent && text?.length > 0
            ? bgColor
            : Slatebox.utils.whiteOrBlack(bgColor)),
        lineColor: '#333',
        lineWidth: 5,
        filters,
        animations,
      }

  if (
    nodeToCreate.nouns.length > 0 &&
    !nodeToCreate.defaultShaped &&
    text?.length > 0
  ) {
    nopts.filters.text = 'embossed'
    nopts.foregroundColor = '#ffffff'
    nopts.shapeHint = 'custom'
  }

  if (nodeToCreate.image?.includes('files.slatebox')) {
    // this is a custom templateDetails images so let's set the embossed
    filters.vect = 'postItNote'
  } else if (nodeToCreate.image && nopts.filters?.vect) {
    delete nopts.filters.vect
  }

  // console.log('nopts to create', nopts)

  const node = new Slatebox.node(nopts)
  // send collaboration info

  // const pkg = {
  //   type: 'onNodeAdded',
  //   data: { nodeOptions: nopts },
  // }
  // slate?.collab.send(pkg)

  const baseAssocOpts = nodeToCreate.transparent
    ? { lineOpacity: 0 }
    : {
        lineEffect: 'postItNote',
        lineWidth: isParent ? 5 : 3,
        lineColor: defaultLineColor,
      }
  slate.nodes.add(node)

  await utils.pause(1000)
  for (const parentId of nodeToCreate.parentCategoryIds) {
    const parentNode = slate.nodes.one(parentId)
    if (parentNode && parentNode.options.id !== node.options.id) {
      parentNode.relationships.addAssociation(node, baseAssocOpts)
    }
    await utils.pause(50)
  }

  // Add additional small nodes for extra nouns
  if (nodeToCreate.nouns.length > 1) {
    const additionalNouns = nodeToCreate.nouns.slice(1)
    const spacing = 20 // Space between small nodes
    let offsetX = nodeWidth + spacing // Start positioning after the main node

    for (const nounPath of additionalNouns) {
      const smallNodeWidth = 90
      const smallNodeHeight = 90
      const smallNodeOpts = {
        id: `${nodeToCreate.id}_noun_${Random.id()}`,
        name: nodeToCreate.id,
        xPos: xPos + offsetX,
        yPos,
        width: smallNodeWidth,
        height: smallNodeHeight,
        vectorPath: pathAtOrigin(
          Slatebox.utils._transformPath(nounPath, `T${xPos + offsetX},${yPos} s.4,.4`)
        ),
        shapeHint: 'custom',
        backgroundColor: bgColor,
        opacity: nopts.opacity,
        lineColor: '#333',
        lineWidth: 2,
        groupId,
        iconFor: nodeToCreate.id,
        filters: {
          vect: 'postItNote',
        },
      }

      const smallNode = new Slatebox.node(smallNodeOpts)
      slate.nodes.add(smallNode)
      smallNode.v2?.toFront(false)
      node.relationships.addAssociation(smallNode, { lineOpacity: 0 })

      offsetX += spacing
    }
  }

  if (nodeToCreate.backgroundNoun) {
    const { cx, cy, adjustedVectorPath, width, height } =
      slate.scaleProportionateToSlateFit({ path: nodeToCreate.backgroundNoun })

    console.log(
      'Scaling background noun with transform:',
      cx,
      cy,
      width,
      height,
      adjustedVectorPath
    )

    // do NOT ADD filters to the background noun
    // it kills the mobile experience
    const backgroundNounOpts = {
      id: `${nodeToCreate.id}_backgroundNoun_${Random.id()}`,
      pinUnderneath: true,
      name: nodeToCreate.id,
      xPos: cx,
      yPos: cy,
      width,
      height,
      vectorPath: adjustedVectorPath,
      backgroundColor: Slatebox.utils.whiteOrBlack(bgColor),
      opacity: '0.1',
      borderOpacity: 0,
    }
    const backgroundNote = new Slatebox.node(backgroundNounOpts)
    slate.nodes.add(backgroundNote)
    backgroundNote.v2?.toBack()
    slate.v2?.removeNode(nodeToCreate.id)
  }
}

// async function updateAINode(aiContent, slate, collaboratorInstanceId) {
//   if (aiContent.areImages) {
//     slate?.collab.exe({
//       type: 'onNodeImageChanged',
//       data: {
//         id: `main_idea_img`,
//         instanceId: collaboratorInstanceId,
//         img: aiContent.images[0],
//         w: aiContent.width || 768,
//         h: aiContent.height || 768,
//       },
//     })
//   } else {
//     switch (aiContent.type) {
//       case CONSTANTS.ai.types.template: {
//         // change the node content
//         break
//       }
//       case CONSTANTS.ai.types.scratch:
//       default: {
//         const nodesToAdjust = [
//           {
//             type: 'title',
//             text: aiContent.title,
//             id: `${aiContent.nodeId}_title`,
//           },
//           {
//             type: 'text',
//             text: aiContent.description,
//             id: `${aiContent.nodeId}_text`,
//           },
//         ]

//         async function ensureNodeExists(id) {
//           return new Promise((resolve, reject) => {
//             const node = slate?.nodes?.one(id)
//             if (!node) {
//               setTimeout(() => {
//                 ensureNodeExists(id)
//               }, 250)
//             } else {
//               resolve(node)
//             }
//           })
//         }

//         for (const n of nodesToAdjust) {
//           const depth = [...n.id.matchAll(/\.|sub/gi)].length
//           // const num = n.text?.length || 20
//           const node = await ensureNodeExists(n.id)
//           // const slateBBox = slate.canvas.bbox()
//           // let denom = n.type === 'title' ? 18 : 32
//           // if (depth > 0) {
//           //   denom =
//           //     n.type === 'title'
//           //       ? Math.ceil(22 / (depth * 1.3))
//           //       : Math.ceil(38 / (depth * 1.3))
//           // }

//           // const charsPerLine = parseInt(num / denom, 10)
//           let numberOfLines = n.type === 'title' ? 2 : 4
//           if (depth > 0) {
//             numberOfLines = n.type === 'title' ? 3 : 8
//           } else if (depth > 1) {
//             numberOfLines = n.type === 'title' ? 3 : 10
//           } else {
//             numberOfLines = n.type === 'title' ? 3 : 12
//           }
//           // console.log('got text', n.text, depth)
//           const text = Slatebox.utils
//             .createMultiLineText(n.text, numberOfLines)
//             .trim()
//           // console.log(
//           //   'got multiline text',
//           //   numberOfLines,
//           //   n.text?.length,
//           //   n.text,
//           //   text,
//           //   n.type
//           // )
//           let fontTitleSize = 48
//           let fontTextSize = 22
//           if (depth === 1) {
//             fontTitleSize = 38
//             fontTextSize = 18
//           } else if (depth === 2) {
//             fontTitleSize = 28
//             fontTextSize = 16
//           } else if (depth > 2) {
//             fontTitleSize = 18
//             fontTextSize = 14
//           }
//           const fontSize = n.type === 'title' ? fontTitleSize : fontTextSize
//           const fontStyle = 'normal'
//           const fontFamily = node?.options?.fontFamily || 'Roboto Sans'
//           // console.log('got fontFamily', fontFamily)
//           const textDimens = Slatebox.utils.getTextWidth(
//             text,
//             `${fontStyle} ${fontSize}pt ${fontFamily}`
//           )
//           const tPadding = 10
//           const width = parseInt(textDimens.width + tPadding, 10)
//           const height = parseInt(textDimens.height + tPadding, 10)

//           // resize
//           // const shapePkg = {
//           //   type: 'onNodeShapeChanged',
//           //   data: {
//           //     id: n.id,
//           //     shape: 'rectangle',
//           //     instanceId: collaboratorInstanceId,
//           //     width,
//           //     height,
//           //   },
//           // }
//           // console.log('sending shape pkg', shapePkg)
//           // slate?.collab.exe(shapePkg)

//           // console.log('applying resize and text', width, height, text, n.id, !!node)

//           node.resize.set(width, height)
//           node.resize.send()
//           // set the text
//           const textPkg = {
//             type: 'onNodeTextChanged',
//             data: {
//               id: n.id,
//               instanceId: collaboratorInstanceId,
//               text,
//               fontSize,
//             },
//           }
//           // console.log('sending text pkg', textPkg)
//           // , fontColor: _self._.options.foregroundColor, textXAlign: _self._.options.textXAlign, textYAlign: _self._.options.textYAlign
//           slate?.collab.exe(textPkg)
//           // set the font family? text and change the size
//         }
//         break
//       }
//     }
//   }
// }

export { createAIConversationNode } // createAINodes, createAISticky, updateAINode,
