import { Meteor } from 'meteor/meteor'
import { Slatebox } from './slatebox/index'
import { saveSlate } from './saveSlate'
import { Organizations } from '../common/models'

async function createSlate(s, events, collaboration, isNew, isGuest) {
  const publicDefault = false
  let sbinst = s

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

  const opts = {
    name: s.options?.name || 'New Slate',
    description: s.options?.description || '',
    defaultLineColor: '#333',
    viewPort: {
      allowDrag: true,
      useInertiaScrolling: true,
      showGrid: false,
      snapToObjects: true,
    },
    showMultiSelect:
      s.options?.showMultiSelect != null ? s.options?.showMultiSelect : true,
    showUndoRedo:
      s.options?.showUndoRedo != null ? s.options?.showUndoRedo : true,
    showbirdsEye:
      s.options?.showbirdsEye != null ? s.options?.showbirdsEye : true,
    showZoom: s.options?.showZoom != null ? s.options?.showZoom : true,
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
  }
  if (isNew) {
    opts.isPublic = publicDefault
    opts.isPrivate = !publicDefault
    opts.isUnlisted = false
  }
  const slate = new Slatebox.Slate(opts, events, collaboration).init()

  slate.shareId = s.shareId

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
    const node = new Slatebox.Node(defaultNodeOpts)
    slate.nodes.add(node)

    await saveSlate({ slate, userId: s.userId, orgId: s.orgId, pkg: {} })

    sbinst = JSON.parse(slate.exportJSON())
  }

  slate.loadJSON(JSON.stringify(sbinst))

  console.log('loaded json', sbinst)

  return slate
}

export default createSlate
