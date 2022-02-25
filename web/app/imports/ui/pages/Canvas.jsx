import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useDispatch, useSelector } from 'react-redux'
import { useTracker } from 'meteor/react-meteor-data'
import * as Cookies from 'js-cookie'
import { useTheme } from '@material-ui/core'
import React, { useEffect } from 'react'
import Grid from '@material-ui/core/Grid'
import { useParams } from 'react-router'
import { useHistory } from 'react-router-dom'
import createSlate from '../../api/client/createSlate'
import { saveSlate } from '../../api/client/saveSlate'

import { CONSTANTS } from '../../api/common/constants'

// global models
import { Collaborators, Slates, Comments } from '../../api/common/models'
import { promisify } from '../../api/client/promisify'
import { CommentDrawer } from '../components/CommentDrawer'
import { NodeDrawer } from '../components/NodeDrawer'
import { LineDrawer } from '../components/LineDrawer'
import { SlateDrawer } from '../components/SlateDrawer'
import { SlateSharing } from '../components/slate/SlateSharing'
import { ExtensionsDrawer } from '../components/ExtensionsDrawer'
import { RemoteCursors } from '../components/RemoteCursors'
import CollaborationUsers from '../components/CollaborationUsers'
import { QuickNodeActions } from '../components/node/QuickNodeActions'
import AuthManager from '../../api/common/AuthManager'
import confirmService from '../common/confirm'

export default function Canvas() {
  const history = useHistory()
  const dispatch = useDispatch()
  const { id } = useParams()
  const theme = useTheme()
  const slate = React.useRef(null)
  const accessLevel = React.useRef({
    isReadOnly: false,
    isCommentOnly: false,
    isEditable: false,
  })
  const collaborator = React.useRef(
    Collaborators.findOne({ shareId: id, userId: Meteor.userId() })
  )
  const slateDrawerOpen = useSelector((state) => state.slateDrawerOpen)
  const extensionsDrawerOpen = useSelector(
    (state) => state.extensionsDrawerOpen
  )
  const createWithTheme = useSelector((state) => state.createWithTheme)
  const containerId = 'slateCanvas'
  const [commentDrawerOpts, setCommentDrawer] = React.useState({
    open: false,
    nodeId: null,
    slateId: null,
    slateName: null,
    orgId: null,
    cb: null,
  })
  const [nodeDrawerOpts, setNodeDrawer] = React.useState({
    open: false,
    node: null,
    cb: null,
    slate: null,
  })
  const [lineDrawerOpts, setLineDrawer] = React.useState({
    open: false,
    node: null,
    association: null,
    cb: null,
  })
  const slateOrgId = React.useRef(null)
  // let canvasReady = useTracker(() => {
  //   console.log("checking if canvas is ready ", Meteor.user(), Meteor.user()?.orgId, Organizations.findOne());
  //   let depsExist = !!(Meteor.user() && (!Meteor.user().orgId || Organizations.findOne()));
  //   console.log("depsExist is ", depsExist, slate.current);
  //   return depsExist;
  // });

  function openComments(node) {
    setCommentDrawer({
      nodeId: node.options.id,
      slateId: slate.current.options.id,
      slateName: slate.current.options.name,
      orgId: slateOrgId.current,
      open: true,
      closeDrawer: () => {
        setCommentDrawer({
          open: false,
          nodeId: null,
          slateId: null,
          slateName: null,
        })
      },
    })
  }

  const onUpdateNode = (pkg, node) => {
    const upkg = pkg
    if (upkg.data.forEach) {
      upkg.data.forEach((p) => {
        const px = p
        px.id = node.options.id
      })
    } else {
      // { type: "onNodeColorChanged", data: { attr: { fill: color, "fill-opacity": 1 }, color: color } }
      upkg.data.id = node.options.id
    }
    node?.slate?.collab.invoke(upkg)

    // always attach the instanceId
    upkg.instanceId = collaborator.current.instanceId

    // saves the collab doc for other slates to observe
    node?.slate?.collab.send(upkg)
  }

  function openNode(node, cb) {
    setNodeDrawer({
      node,
      slate: slate.current,
      cb,
      open: true,
      updateNode: (pkg) => {
        onUpdateNode(pkg, node)
      },
      closeDrawer: () => {
        setNodeDrawer({ open: false, updateNode: null })
      },
    })
  }

  function handleNodeCreated(node) {
    if (node.options.isComment) {
      openComments(node)
    } else {
      setNodeDrawer({
        node,
        slate: slate.current,
        open: true,
        updateNode: (pkg) => {
          const upkg = pkg
          upkg.data.id = node.options.id
          node?.slate?.collab.invoke(upkg)

          // always attach the instanceId
          upkg.instanceId = collaborator.current.instanceId

          // saves the collab doc for other slates to observe
          node?.slate?.collab.send(upkg)
        },
        closeDrawer: () => {
          setNodeDrawer({ open: false })
        },
      })
    }
  }

  useTracker(() => {
    if (slate.current) {
      Meteor.subscribe(CONSTANTS.publications.comments, {
        slateId: slate.current.options.id,
      })
      const allCommentIds = slate.current.nodes.allNodes
        .filter((n) => n.options.isComment)
        .map((nx) => nx.options.id)
      const commentCountByNodeId = {
        resolved: {},
        unresolved: {},
        empty: {},
      }
      Comments.find({}).forEach((c) => {
        if (c.resolved) {
          if (!commentCountByNodeId.resolved[c.nodeId]) {
            commentCountByNodeId.resolved[c.nodeId] = 0
          }
          commentCountByNodeId.resolved[c.nodeId] += 1
        } else {
          if (!commentCountByNodeId.unresolved[c.nodeId]) {
            commentCountByNodeId.unresolved[c.nodeId] = 0
          }
          commentCountByNodeId.unresolved[c.nodeId] += 1
        }
      })

      Object.keys(commentCountByNodeId.resolved).forEach((n) => {
        const node = slate.current.nodes.allNodes.find(
          (nx) => nx.options.id === n
        )
        node?.editor.set(commentCountByNodeId.resolved[n])
        node?.colorPicker.set({
          opacity: 1,
          color: theme.palette.success.light,
        })
      })
      Object.keys(commentCountByNodeId.unresolved).forEach((n) => {
        const node = slate.current.nodes.allNodes.find(
          (nx) => nx.options.id === n
        )
        node?.editor.set(commentCountByNodeId.unresolved[n])
        node?.colorPicker.set({ opacity: 1, color: theme.palette.error.light })
      })
      const resolvedOrUnresolved = Object.keys(
        commentCountByNodeId.resolved
      ).concat(Object.keys(commentCountByNodeId.unresolved))
      allCommentIds.forEach((n) => {
        if (!resolvedOrUnresolved.includes(n)) {
          const node = slate.current.nodes.allNodes.find(
            (nx) => nx.options.id === n
          )
          node?.editor.set(`?`)
          node?.colorPicker.set({
            opacity: 1,
            color: theme.palette.secondary.main,
          })
        }
      })
    }
  })

  function onSlateUpdate(pkg) {
    const upkg = pkg
    // invoke updates the local slate

    // console.log("slate updated", pkg);
    slate.current?.collab.invoke(upkg)

    // always attach the instanceId
    // console.log("collab id is ", collaborator.current.instanceId);
    upkg.instanceId = collaborator.current.instanceId
    // upkg.shareId = slate?.shareId;

    // send updates any remote slates
    slate.current?.collab.send(upkg)
  }

  useEffect(() => {
    async function loadSlate(slateBase, isNew, isGuest) {
      const cSlateBase = slateBase
      if (Meteor.user() && Meteor.user().orgId) {
        cSlateBase.orgId = Meteor.user().orgId
      }

      // attach events and collaboration
      const events = {
        onConfirmRequested: async (title, msg, cb) => {
          const res = await confirmService.show({
            theme,
            title,
            message: msg,
            actionItems: [
              { label: 'Cancel', return: false },
              { label: 'OK', return: true },
            ],
          })
          cb(res)
        },
        onTakeSnapshot: async (opts) => {
          await promisify(
            Meteor.call,
            CONSTANTS.methods.slates.createSnapshot,
            { slateId: opts.slateId, snapshot: opts.snapshot }
          )
        },
        onTextPaneRequested: (node, cb) => {
          // always disable the canvas until closed
          dispatch({
            type: 'canvas',
            slateDrawerOpen: false,
            extensionsDrawerOpen: false,
          })
          if (node.options.isComment) {
            openComments(node)
          } else {
            openNode(node, cb)
          }
        },
        onLineMenuRequested: (node, association, cb) => {
          // always disable the canvas until closed
          dispatch({
            type: 'canvas',
            slateDrawerOpen: false,
            extensionsDrawerOpen: false,
          })
          setLineDrawer({
            node,
            association,
            cb,
            open: true,
            updateLine: (pkg) => {
              onUpdateNode(pkg, node)
            },
            closeDrawer: () => {
              setLineDrawer({ open: false, updateLine: null })
            },
          })
        },
        onMenuRequested: (node, cb) => {
          // console.log("menu requested ", node);
          dispatch({
            type: 'canvas',
            slateDrawerOpen: false,
            extensionsDrawerOpen: false,
          })
          if (node.options.isComment) {
            openComments(node)
          } else {
            openNode(node, cb)
          }
        },
        onBase64ImageRequested: (imgUrl, imageType, cb) => {
          async function get() {
            try {
              const results = await promisify(
                Meteor.call,
                CONSTANTS.methods.utils.base64StringFromRemoteUrl,
                { type: imageType, url: imgUrl }
              )
              cb(null, results)
            } catch (err) {
              cb(err)
            }
          }
          get()
        },
        onOptimizeSVG: (svg, cb) => {
          async function get() {
            try {
              // console.log("optimizing", svg);
              const optimized = await promisify(
                Meteor.call,
                CONSTANTS.methods.utils.optimizeSVG,
                svg
              )
              // console.log("optimized", optimized);
              cb(null, optimized)
            } catch (err) {
              cb(err)
            }
          }
          get()
        },
        isReadOnly: () => accessLevel.current.isReadOnly,
        isCommentOnly: () => accessLevel.current.isCommentOnly,
        canRemoveComments: () => {
          const canRemoveComments = AuthManager.userHasClaim(Meteor.userId(), [
            CONSTANTS.claims.canRemoveComments._id,
          ])
          return canRemoveComments
        },
        onThemeRequired: (opts, cb) => {
          Meteor.call(
            CONSTANTS.methods.themes.getThemes,
            { themeId: opts.themeId },
            (err, res) => {
              cb(err, res)
            }
          )
        },
      }

      const collaboration = {
        allow: true,
        localizedOnly: false,
        async onCollaboration(opts) {
          // always add the instanceId
          opts.instanceId = collaborator.current.instanceId

          switch (opts.type) {
            case 'process': {
              // special handling of deleted comment node
              if (
                opts.pkg.type === 'onNodeDeleted' &&
                opts.pkg.data.isComment
              ) {
                // console.log("raw pkg", opts.pkg);
                // console.log("going to remove comments ", { nodeId: opts.pkg.data.id, slateId: slate.current.options.id, orgId: Meteor.user().orgId });
                const res = await promisify(
                  Meteor.call,
                  CONSTANTS.methods.comments.remove,
                  {
                    nodeId: opts.pkg.data.id,
                    slateId: slate.current.options.id,
                    orgId: Meteor.user().orgId,
                  }
                )
              }
              await saveSlate(opts)
              break
            }
            case 'custom': {
              switch (opts.pkg.type) {
                case 'onSaveRequested':
                default: {
                  if (opts.pkg._id) {
                    const json = JSON.stringify(
                      Slates.findOne({ shareId: opts.pkg.slateId })
                    )
                  } else {
                    await saveSlate(opts)
                  }
                  break
                }
              }
              break
            }
            case 'init':
            default: {
              break
            }
          }
        },
      }

      // create slate
      // console.log("going to create slate", isNew);
      slate.current = await createSlate(
        cSlateBase,
        events,
        collaboration,
        isNew,
        isGuest
      )

      if (createWithTheme) {
        slate.current.applyTheme(createWithTheme, true)
        // fix for init node
        // slate.nodes.allNodes[0].options.vectorPath = slate.nodes.allNodes[0].vect.attr("path");
        dispatch({ type: 'canvas', createWithTheme: null })
        await saveSlate({ slate: slate.current })
      }

      // set slate name and always attach shareId, userId and orgId to the dispatched slate
      slate.current.shareId = cSlateBase.shareId
      slate.current.userId = cSlateBase.userId
      slate.current.orgId = cSlateBase.orgId
      dispatch({
        type: 'canvas',
        slateName: slate.current?.options?.name,
        slate: slate.current,
      })

      console.trace()

      return true
    } // loadSlate

    async function prep() {
      let isNew = false
      const getSlate = await promisify(
        Meteor.call,
        CONSTANTS.methods.slates.get,
        { shareId: id }
      )
      // console.log("got slate perm ", getSlate);
      let slateBase = null
      if (getSlate?.exists === false) {
        isNew = true
        slateBase = { name: 'New Slate', userId: Meteor.userId(), shareId: id }
        if (Meteor.user().orgId) {
          slateBase.orgId = Meteor.user().orgId
        }
      } else if (getSlate?.accessLevel) {
        slateBase = getSlate.slateBase
        slateOrgId.current = getSlate.slateBase.orgId
        accessLevel.current = {
          isReadOnly:
            getSlate.accessLevel === CONSTANTS.slateAccessPermissions.read.id,
          isCommentOnly:
            getSlate.accessLevel ===
            CONSTANTS.slateAccessPermissions.comment.id,
          isEditable:
            getSlate.accessLevel === CONSTANTS.slateAccessPermissions.edit.id,
        }
      }
      if (!slateBase) {
        // no access, redirect away
        const redirect = Meteor.user() ? '/' : '/login'
        history.push(redirect)
        await confirmService.show({
          theme,
          title: `No Access`,
          message: `This slate is not accessible.`,
          actionItems: [{ label: 'OK', return: true }],
        })
        return
      }

      dispatch({
        type: 'canvas',
        canManageSlate:
          !accessLevel.current.isReadOnly && !accessLevel.current.isCommentOnly,
      })
      const requiresTracking =
        !Meteor.user() ||
        (!isNew && Meteor.user() && Meteor.user().orgId !== slateBase.orgId)

      if (!collaborator.current) {
        let id = Random.id()
        if (requiresTracking) {
          if (!Cookies.get(CONSTANTS.guestCollaboratorCookieId)) {
            Cookies.set(CONSTANTS.guestCollaboratorCookieId, id, { expires: 1 }) // always a one day expiration
          }
          id = Cookies.get(CONSTANTS.guestCollaboratorCookieId)
        }
        collaborator.current = await promisify(
          Meteor.call,
          CONSTANTS.methods.collaborators.create,
          { shareId: slateBase.shareId, userId: Meteor.userId(), id }
        )
        dispatch({ type: 'collaborator', collaborator: collaborator.current })
      }

      // if user doesn't exist here, we should log them as a guest -- they're viewing
      // the canvas of an unlisted slate
      let verb = ''
      if (accessLevel.current.isReadOnly) {
        verb = 'read-only'
      } else if (accessLevel.current.isCommentOnly) {
        verb = 'comment-only'
      } else if (accessLevel.current.isEditable) {
        verb = 'full'
      }
      if (requiresTracking) {
        let trackGuest = await promisify(
          Meteor.call,
          CONSTANTS.methods.organizations.trackGuest,
          {
            slateOrgId: slateBase.orgId,
            slateId: slateBase.options.id,
            slateOwner: slateBase.userId,
            userId: Meteor.userId(),
            orgId: Meteor.user() ? Meteor.user().orgId || null : null,
            guestCollaboratorId: collaborator.current.instanceId,
            isUnlisted: slateBase.options.isUnlisted,
            isPublic: slateBase.options.isPublic,
          }
        )

        if (slateBase.options.isUnlisted) {
          // allowed and noted
          await loadSlate(slateBase, false, true)
          await confirmService.show({
            theme,
            title: `Welcome to Slatebox!`,
            message: `You have ${verb} access to this slate by ${trackGuest.slateOwnerUserName}. Enjoy!`,
            actionItems: [{ label: 'OK', return: true }],
          })
        } else if (slateBase.options.isPublic) {
          // public slate
          await loadSlate(slateBase, false, true)
          await confirmService.show({
            theme,
            title: `Welcome to Slatebox!`,
            message: `You have ${verb} access to this publically accessible slate by ${trackGuest.slateOwnerUserName}. Enjoy!`,
            actionItems: [{ label: 'OK', return: true }],
          })
        }
      } else {
        await loadSlate(slateBase, isNew, false)
        if (Meteor.userId() !== slateBase.userId) {
          await confirmService.show({
            theme,
            title: `Welcome to Slatebox!`,
            message: `You have ${verb} access to this slate. Enjoy!`,
            actionItems: [{ label: 'OK', return: true }],
          })
        }
      }
    } // prep

    prep()

    dispatch({ type: 'canvas', onCanvas: true })
    return () => {
      dispatch({ type: 'canvas', onCanvas: false })
    }
  }, [])

  return (
    <RemoteCursors
      shareId={slate?.current?.shareId}
      instanceId={collaborator?.current?.instanceId}
    >
      <Grid container>
        <Grid xs={12} item id={containerId} style={{ height: 'inherit' }} />
        {!accessLevel.current.isReadOnly &&
          !slate?.current?.options?.eligibleForThemeCompilation && (
            <QuickNodeActions
              slate={slate?.current}
              onNodeCreated={handleNodeCreated}
              commentAccessOnly={accessLevel.current.isCommentOnly}
            />
          )}
      </Grid>
      <CommentDrawer {...commentDrawerOpts} />
      <NodeDrawer {...nodeDrawerOpts} />
      <LineDrawer {...lineDrawerOpts} />
      <SlateSharing slate={slate.current} />
      <SlateDrawer
        open={slateDrawerOpen}
        onExport={(type, opts, cb) => {
          slate.current[type](opts, cb)
        }}
        getOrientation={() => slate.current.getOrientation()}
        updateSlate={onSlateUpdate}
        slate={slate.current}
        onDrawerClose={(e) => {
          dispatch({ type: 'canvas', slateDrawerOpen: false })
        }}
      />
      <ExtensionsDrawer
        open={extensionsDrawerOpen}
        slate={slate.current}
        updateSlate={onSlateUpdate}
        onDrawerClose={(e) => {
          dispatch({ type: 'canvas', extensionsDrawerOpen: false })
        }}
      />
      <CollaborationUsers slate={slate.current} />
    </RemoteCursors>
  )
}
