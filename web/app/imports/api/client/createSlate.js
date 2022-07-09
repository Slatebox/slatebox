/* eslint-disable new-cap */
import { Meteor } from 'meteor/meteor'
import { Slatebox } from 'slateboxjs'
import saveSlate from './saveSlate'
import { Organizations } from '../common/models'

async function createSlate(slateBase, events, collaboration, isNew, isGuest) {
  let publicDefault = true
  let newSlate = slateBase
  async function ensureDeps() {
    return new Promise((resolve) => {
      if (
        (Meteor.user() && Meteor.user().orgId && Organizations.findOne()) ||
        (Meteor.user() && !Meteor.user().orgId) ||
        isGuest
      ) {
        resolve(true)
      } else {
        setTimeout(async () => {
          resolve(await ensureDeps())
        }, 500)
      }
    })
  }

  await ensureDeps()

  if (Meteor.user() && Meteor.user().orgId) {
    publicDefault = Organizations.findOne().planType === 'free'
  } else if (Meteor.user() && Meteor.user().planType !== 'free') {
    publicDefault = false
  }

  const opts = {
    name: newSlate.options?.name || 'New Slate',
    description: newSlate.options?.description || '',
    defaultLineColor: '#333',
    viewPort: {
      allowDrag: true,
      useInertiaScrolling: true,
      showGrid: false,
      snapToObjects: true,
    },
    showMultiSelect:
      newSlate.options?.showMultiSelect != null
        ? newSlate.options?.showMultiSelect
        : true,
    showUndoRedo:
      newSlate.options?.showUndoRedo != null
        ? newSlate.options?.showUndoRedo
        : true,
    showbirdsEye:
      newSlate.options?.showbirdsEye != null
        ? newSlate.options?.showbirdsEye
        : true,
    showZoom:
      newSlate.options?.showZoom != null ? newSlate.options?.showZoom : true,
    isSharing: true,
    imageFolder: '/images/',
    container: 'slateCanvas',
    enabled: true,
    containerStyle: {
      width: 'auto',
      height: 'auto',
      backgroundColor: '#ffffff',
      backgroundImage: null,
      backgroundSize: 'cover',
      backgroundEffect: null,
      prevBackgroundColor: 'transparent',
      backgroundColorAsGradient: true,
      backgroundGradientType: 'radial',
      backgroundGradientColors: [
        '#ffffff',
        '#f0f0f0',
        '#e1e1e1',
        '#d2d2d2',
        '#c3c3c3',
      ],
      backgroundGradientStrategy: 'shades',
    },
    collaboration: {
      allow: true,
    },
    huddleType: 'audio',
  }
  if (isNew) {
    opts.isPublic = publicDefault
    opts.isPrivate = !publicDefault
    opts.isUnlisted = false
  }

  const slate = new Slatebox.slate(opts, events, collaboration).init()

  slate.shareId = newSlate.shareId

  if (isNew) {
    // this is a new slate -- create a first node
    const defaultNodeOpts = {
      name: 'mn',
      text: '',
      xPos: 10000,
      yPos: 10000,
      height: 100,
      width: 175,
      vectorPath: 'roundedrectangle',
      backgroundColor: '#4051B5',
      fontFamily: 'Roboto',
      foregroundColor: '#fff',
      lineColor: '#333',
      lineWidth: 5,
    }
    Object.assign(defaultNodeOpts, {})
    const node = new Slatebox.node(defaultNodeOpts)
    slate.nodes.add(node)

    await saveSlate({
      slate,
      userId: newSlate.userId,
      orgId: newSlate.orgId,
      pkg: {},
    })

    newSlate = JSON.parse(slate.exportJSON())
  }

  slate.loadJSON(JSON.stringify(newSlate))

  return slate
}

export default createSlate
