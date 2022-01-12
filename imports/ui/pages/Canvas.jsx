import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { useDispatch, useSelector } from 'react-redux'
import { useTracker } from 'meteor/react-meteor-data';
import * as Cookies from "js-cookie";
import { useTheme } from '@material-ui/core';
import React, { useEffect } from 'react';
import Grid from '@material-ui/core/Grid'
import { useParams } from "react-router";
import { useHistory } from "react-router-dom";
import { createSlate } from '../../api/client/createSlate.js';
import { saveSlate } from '../../api/client/saveSlate.js';

import { CONSTANTS } from '../../api/common/constants.js';

//global models
import { Collaboration, Collaborators, Organizations, SlateAccess, Slates, Comments } from '../../api/common/models.js';
import { promisify } from '../../api/client/promisify.js';
import { CommentDrawer } from '../components/CommentDrawer.jsx';
import { NodeDrawer } from '../components/NodeDrawer.jsx';
import { LineDrawer } from '../components/LineDrawer.jsx';
import { SlateDrawer } from '../components/SlateDrawer.jsx';
import { SlateSharing } from '../components/slate/SlateSharing.jsx'
import { ExtensionsDrawer } from '../components/ExtensionsDrawer.jsx';
import { RemoteCursors } from '../components/RemoteCursors.jsx';
import { CollaborationUsers } from '../components/CollaborationUsers.jsx';
import { QuickNodeActions } from '../components/node/QuickNodeActions.jsx';
import AuthManager from '../../api/common/AuthManager.js';
import confirmService from '../../ui/common/confirm';

export const Canvas = () => {
  const history = useHistory();
  const dispatch = useDispatch();
  const { id } = useParams();
  const theme = useTheme();
  const slate = React.useRef(null);
  const accessLevel = React.useRef({ isReadOnly: false, isCommentOnly: false, isEditable: false });
  const collaborator = React.useRef(Collaborators.findOne({ shareId: id, userId: Meteor.userId() }));
  const slateDrawerOpen = useSelector(state => state.slateDrawerOpen);
  const extensionsDrawerOpen = useSelector(state => state.extensionsDrawerOpen);
  const createWithTheme = useSelector(state => state.createWithTheme);
  let containerId = "slateCanvas";
  const [commentDrawerOpts, setCommentDrawer] = React.useState({ open: false, nodeId: null, slateId: null, slateName: null, orgId: null, cb: null });
  const [nodeDrawerOpts, setNodeDrawer] = React.useState({ open: false, node: null, cb: null });
  const [lineDrawerOpts, setLineDrawer] = React.useState({ open: false, node: null, association: null, cb: null });
  const slateOrgId = React.useRef(null);
  // let canvasReady = useTracker(() => {
  //   console.log("checking if canvas is ready ", Meteor.user(), Meteor.user()?.orgId, Organizations.findOne());
  //   let depsExist = !!(Meteor.user() && (!Meteor.user().orgId || Organizations.findOne()));
  //   console.log("depsExist is ", depsExist, slate.current);
  //   return depsExist;
  // });

  function openComments(node) {
    setCommentDrawer({
      nodeId: node.options.id
      , slateId: slate.current.options.id
      , slateName: slate.current.options.name
      , orgId: slateOrgId.current
      , open: true
      , closeDrawer: () => {
        setCommentDrawer({ open: false, nodeId: null, slateId: null, slateName: null })
      }
    });
  }

  const onUpdateNode = (pkg, node) => {
    if (pkg.data.forEach) {
      pkg.data.forEach(p => p.id = node.options.id);
    } else {
    //{ type: "onNodeColorChanged", data: { attr: { fill: color, "fill-opacity": 1 }, color: color } }
      pkg.data.id = node.options.id;
    }
    node?.slate?.collab.invoke(pkg);

    //always attach the instanceId
    pkg.instanceId = collaborator.current.instanceId;

    //saves the collab doc for other slates to observe
    node?.slate?.collab.send(pkg);
  };

  function openNode(node, cb) {
    setNodeDrawer({
      node: node
      , slate: slate.current
      , cb: cb
      , open: true
      , updateNode: (pkg) => {
        onUpdateNode(pkg, node);
      }
      , closeDrawer: () => {
        setNodeDrawer({ open: false, updateNode: null });
      }
    });
  }

  function handleNodeCreated(node, tabType) {
    if (node.options.isComment) {
      openComments(node);
    } else {
      setNodeDrawer({
        node: node
        , open: true
        , updateNode: (pkg) => {

          pkg.data.id = node.options.id;
          node?.slate?.collab.invoke(pkg);
      
          //always attach the instanceId
          pkg.instanceId = collaborator.current.instanceId;
      
          //saves the collab doc for other slates to observe
          node?.slate?.collab.send(pkg);
        }
        , closeDrawer: () => {
          setNodeDrawer({ open: false });
        }
      });
    }
  }

  useTracker(() => {
    if (slate.current) {
      Meteor.subscribe(CONSTANTS.publications.comments, { slateId: slate.current.options.id });
      const allCommentIds = slate.current.nodes.allNodes.filter(n => n.options.isComment).map(nx => nx.options.id);
      let commentCountByNodeId = {
        resolved: {},
        unresolved: {},
        empty: {}
      };
      Comments.find({}).forEach(c => {
        if (c.resolved) {
          if (!commentCountByNodeId.resolved[c.nodeId]) {
            commentCountByNodeId.resolved[c.nodeId] = 0;
          }
          commentCountByNodeId.resolved[c.nodeId]++;
        } else {
          if (!commentCountByNodeId.unresolved[c.nodeId]) {
            commentCountByNodeId.unresolved[c.nodeId] = 0;
          }
          commentCountByNodeId.unresolved[c.nodeId]++;
        }
      });
      //console.log("Resolved, unresolved", commentCountByNodeId);
      Object.keys(commentCountByNodeId.resolved).forEach(n => {
        const node = slate.current.nodes.allNodes.find(nx => nx.options.id === n);
        node?.editor.set(commentCountByNodeId.resolved[n]);
        node?.colorPicker.set({ opacity: 1, color: theme.palette.success.light });
      });
      Object.keys(commentCountByNodeId.unresolved).forEach(n => {
        const node = slate.current.nodes.allNodes.find(nx => nx.options.id === n);
        node?.editor.set(commentCountByNodeId.unresolved[n]);
        node?.colorPicker.set({ opacity: 1, color: theme.palette.error.light });
      });
      let resolvedOrUnresolved = Object.keys(commentCountByNodeId.resolved).concat(Object.keys(commentCountByNodeId.unresolved));
      allCommentIds.forEach(n => {
        if (!resolvedOrUnresolved.includes(n)) {
          const node = slate.current.nodes.allNodes.find(nx => nx.options.id === n);
          node?.editor.set(`?`);
          node?.colorPicker.set({ opacity: 1, color: theme.palette.secondary.main });
        }
      });
    }
  });

  function onSlateUpdate(pkg) {
    //invoke updates the local slate
    
    //console.log("slate updated", pkg);
    slate.current?.collab.invoke(pkg);

    //always attach the instanceId
    //console.log("collab id is ", collaborator.current.instanceId);
    pkg.instanceId = collaborator.current.instanceId;
    //pkg.shareId = slate?.shareId;

    //send updates any remote slates
    slate.current?.collab.send(pkg);
  }

  useEffect(() => {

    async function prep() {
      let isNew = false;
      let getSlate = await promisify(Meteor.call, CONSTANTS.methods.slates.get, { shareId: id });
      //console.log("got slate perm ", getSlate);
      let slateBase = null;
      if (getSlate?.exists === false) {
        isNew = true;
        slateBase = { name: "New Slate", userId: Meteor.userId(), shareId: id };
        if (Meteor.user().orgId) {
          slateBase.orgId = Meteor.user().orgId;
        }
      } else if (getSlate?.accessLevel) {
        slateBase = getSlate.slateBase;
        slateOrgId.current = getSlate.slateBase.orgId;
        accessLevel.current = {
          isReadOnly: getSlate.accessLevel === CONSTANTS.slateAccessPermissions.read.id,
          isCommentOnly: getSlate.accessLevel === CONSTANTS.slateAccessPermissions.comment.id,
          isEditable: getSlate.accessLevel === CONSTANTS.slateAccessPermissions.edit.id
        }
      }
      if (!slateBase) {
        //no access, redirect away
        const redirect = Meteor.user() ? "/" : "/login";
        history.push(redirect);
        await confirmService.show({
          theme: theme,
          title: `No Access`,
          message: `This slate is not accessible.`,
          actionItems: [
            { label: "OK", return: true }
          ]
        });
        return;
      }
      
      dispatch({ type: "canvas", canManageSlate: (!accessLevel.current.isReadOnly && !accessLevel.current.isCommentOnly) });
      let requiresTracking = !Meteor.user() || (!isNew && Meteor.user() && Meteor.user().orgId !== slateBase.orgId);

      if (!collaborator.current) {
        let id = Random.id();
        if (requiresTracking) {
          if (!Cookies.get(CONSTANTS.guestCollaboratorCookieId)) {
            Cookies.set(CONSTANTS.guestCollaboratorCookieId, id, { expires: 1 }); //always a one day expiration
          }
          id = Cookies.get(CONSTANTS.guestCollaboratorCookieId);
        }
        collaborator.current = await promisify(Meteor.call, CONSTANTS.methods.collaborators.create, { shareId: slateBase.shareId, userId: Meteor.userId(), id: id });
        dispatch({ type: "collaborator", collaborator: collaborator.current });
      }

      //if user doesn't exist here, we should log them as a guest -- they're viewing 
      //the canvas of an unlisted slate
      let verb = "";
      if (accessLevel.current.isReadOnly) {
        verb = "read-only";
      } else if (accessLevel.current.isCommentOnly) {
        verb = "comment-only";
      } else if (accessLevel.current.isEditable) {
        verb = "full";
      }
      if (requiresTracking) {
        let trackGuest = await promisify(Meteor.call, CONSTANTS.methods.organizations.trackGuest, { 
          slateOrgId: slateBase.orgId,
          slateId: slateBase.options.id,
          slateOwner: slateBase.userId,
          userId: Meteor.userId(),
          orgId: Meteor.user() ? Meteor.user().orgId || null : null,
          guestCollaboratorId: collaborator.current.instanceId,
          isUnlisted: slateBase.options.isUnlisted,
          isPublic: slateBase.options.isPublic
        });

        if (slateBase.options.isUnlisted) {
          if (trackGuest.allow) {
            //allowed and noted
            loadSlate(slateBase, false, true);
            await confirmService.show({
              theme: theme,
              title: `Welcome to Slatebox!`,
              message: `You have ${verb} access to this slate by ${trackGuest.slateOwnerUserName}. Enjoy!`,
              actionItems: [
                { label: "OK", return: true }
              ]
            });
          } else {
            //not allowed
            //show the slate, but then layer immediately with the confirm dialogue; don't allow editing...
            await loadSlate(slateBase, false, true);
            await confirmService.show({
              theme: theme,
              title: `Oops...there are no more guest views available this month.`,
              message: `Apologies, but ${verb} access to this slate won't work right now - the organization has exceeded its limit of guest slate interactions this month.`,
              actionItems: [
                { label: "OK", return: true }
              ]
            });
            history.push(Meteor.settings.public.baseUrl);
          }    
        } else if (slateBase.options.isPublic) {
          //public slate
          loadSlate(slateBase, false, true);
          await confirmService.show({
            theme: theme,
            title: `Welcome to Slatebox!`,
            message: `You have ${verb} access to this publically accessible slate by ${trackGuest.slateOwnerUserName}. Enjoy!`,
            actionItems: [
              { label: "OK", return: true }
            ]
          });
        }
        //if the org is on the free plan, limit the number of guest collaborators (without creating a user) to three.
        // try {
        //   let email = await promisify(Meteor.call, CONSTANTS.methods.users.createAnonymous, { orgId: slateBase.orgId });
        //   console.log("call completed ", email);
        //   Meteor.loginWithPassword(email, CONSTANTS.anonUserPwd, (err, data) => {
        //     loadSlate(slateBase, isNew);
        //   });
        // } catch (err) {
        //   console.log("error ", err);
        // }
      } else {
        loadSlate(slateBase, isNew, false);
        if (Meteor.userId() !== slateBase.userId) {
          await confirmService.show({
            theme: theme,
            title: `Welcome to Slatebox!`,
            message: `You have ${verb} access to this slate. Enjoy!`,
            actionItems: [
              { label: "OK", return: true }
            ]
          });
        }
      }
    } //prep

    async function loadSlate(slateBase, isNew, isGuest) {
      if (Meteor.user() && Meteor.user().orgId) {
        slateBase.orgId = Meteor.user().orgId;
      }
      
      //attach events and collaboration
      const events = {
        onConfirmRequested: async (title, msg, cb) => {
          let res = await confirmService.show({
            theme: theme,
            title: title,
            message: msg,
            actionItems: [
              { label: "Cancel", return: false },
              { label: "OK", return: true }
            ]
          });
          console.log("res is ", res);
          cb(res);
        },
        onTakeSnapshot: async (opts) => {
          await promisify(Meteor.call, CONSTANTS.methods.slates.createSnapshot, { slateId: opts.slateId, snapshot: opts.snapshot });
        },
        onTextPaneRequested: (node, cb) => {
          //always disable the canvas until closed
          dispatch({ type: "canvas", slateDrawerOpen: false, extensionsDrawerOpen: false });
          if (node.options.isComment) {
            openComments(node);
          } else {
            openNode(node, cb);
          }
        },
        onLineMenuRequested: (node, association, cb) => {
          //always disable the canvas until closed
          dispatch({ type: "canvas", slateDrawerOpen: false, extensionsDrawerOpen: false });
          setLineDrawer({
            node: node
            , association: association
            , cb: cb
            , open: true
            , updateLine: (pkg) => {
              onUpdateNode(pkg, node);
            }
            , closeDrawer: () => {
              setLineDrawer({ open: false, updateLine: null })
            }
          })
        },
        onMenuRequested: (node, cb) => {
          //console.log("menu requested ", node);
          dispatch({ type: "canvas", slateDrawerOpen: false, extensionsDrawerOpen: false });
          if (node.options.isComment) {
            openComments(node);
          } else {
            openNode(node, cb);
          }
        },
        onBase64ImageRequested: (imgUrl, imageType, cb) => {
          async function get() {
            try {
              let results = await promisify(Meteor.call, CONSTANTS.methods.utils.base64StringFromRemoteUrl, { type: imageType, url: imgUrl });
              cb(null, results);
            } catch (err) {
              cb(err);
            }
          }
          get();
        },
        onOptimizeSVG: (svg, cb) => {
          async function get() {
            try {
              //console.log("optimizing", svg);
              let optimized = await promisify(Meteor.call, CONSTANTS.methods.utils.optimizeSVG, svg);
              //console.log("optimized", optimized);
              cb(null, optimized);
            } catch (err) {
              cb(err);
            }
          }
          get();
        },
        isReadOnly: () => {
          return accessLevel.current.isReadOnly;
        },
        isCommentOnly: () => {
          return accessLevel.current.isCommentOnly;
        },
        canRemoveComments: () => {
          const canRemoveComments = AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canRemoveComments._id]);
          return canRemoveComments;
        },
        onThemeRequired: (opts, cb) => {
          Meteor.call(CONSTANTS.methods.themes.getThemes, { themeId: opts.themeId }, (err, res) => {
            cb(err, res);
          });
        }
        // onCreateImage: (opts, cb) => {
        //   async function create() {
        //     try {
        //       let base64Image = await promisify(Meteor.call, CONSTANTS.methods.utils.createImage, opts);
        //       console.log("base64Image", base64Image);
        //       cb(null, base64Image);
        //     } catch (err) {
        //       cb(err);
        //     }
        //   }
        //   create();
        // }
      };
      
      const collaboration = {
        allow: true
        , localizedOnly: false
        , onCollaboration: async function (opts) {

          //always add the instanceId
          opts.instanceId = collaborator.current.instanceId;

          switch (opts.type) {
            case "init":
              break;
            case "process":
              //special handling of deleted comment node
              if (opts.pkg.type === "onNodeDeleted" && opts.pkg.data.isComment) {
                //console.log("raw pkg", opts.pkg);
                //console.log("going to remove comments ", { nodeId: opts.pkg.data.id, slateId: slate.current.options.id, orgId: Meteor.user().orgId });
                const res = await promisify(Meteor.call, CONSTANTS.methods.comments.remove, { nodeId: opts.pkg.data.id, slateId: slate.current.options.id, orgId: Meteor.user().orgId });
              }
              await saveSlate(opts);
              break;
            case "custom":
              switch (opts.pkg.type) {
                // case "onSlateNameChanged": {
                //   await saveSlate(opts);
                //   break;
                // }
                // case "onSlateDescriptionChanged": {
                //   await saveSlate(opts);
                //   break;
                // }
                case "onSlateVideoChatChanged": {
                  await saveSlate(opts);
                  break;
                }
                // case "onLineColorChanged":
                //   Meteor.SB.customCollab.applySlateColors(null, opts.pkg.data.color);
                //   break;
                // case "onSlateBackgroundColorChanged":
                //   Meteor.SB.customCollab.applySlateColors(opts.pkg.data.color);
                //   break;
                // case "onSlateVideoChatChanged":
                //   Meteor.SB.customCollab.applyVideoChatChange(opts.pkg.data.allowVideoChat);
                //   break;
                case "onSaveRequested":
                  if (opts.pkg._id) {
                    //slate was already saved because _id is the collab document id
                    const _json = JSON.stringify(Slates.findOne({ shareId: opts.pkg.slateId }));
                    // Meteor.currentSlate.loadJSON(_json);
                    // Meteor.currentSlate.birdseye && Meteor.currentSlate.birdseye.reload(_json);
                  } else {
                    await saveSlate(opts);
                  }
                  break;
              }
              break;
          }
        }
      };
      
      //create slate
      //console.log("going to create slate", isNew);
      slate.current = await createSlate(slateBase, events, collaboration, isNew, isGuest);

      if (createWithTheme) {
        slate.current.applyTheme(createWithTheme, true);
        dispatch({ type: "canvas", createWithTheme: null });
        await saveSlate({ slate: slate.current });
      }
      
      //set slate name and always attach shareId, userId and orgId to the dispatched slate
      slate.current.shareId = slateBase.shareId;
      slate.current.userId = slateBase.userId;
      slate.current.orgId = slateBase.orgId;
      dispatch({ type: "canvas", slateName: slate.current?.options?.name, slate: slate.current });
    
      return true;
    } //loadSlate

    prep();
    
    dispatch({ type: "canvas", onCanvas: true });
    return () => {
      dispatch({ type: "canvas", onCanvas: false });
    }

  }, [])

  return (
    <RemoteCursors shareId={slate?.current?.shareId} instanceId={collaborator?.current?.instanceId}>
      <Grid container>
        <Grid xs={12} item id={containerId} style={{ height: "inherit" }}>
        </Grid>
        {!accessLevel.current.isReadOnly && !slate?.current?.options?.eligibleForThemeCompilation &&
          <QuickNodeActions slate={slate?.current} onNodeCreated={handleNodeCreated} commentAccessOnly={accessLevel.current.isCommentOnly} />
        }
      </Grid>
      <CommentDrawer {...commentDrawerOpts} />
      <NodeDrawer {...nodeDrawerOpts} />
      <LineDrawer {...lineDrawerOpts} />
      <SlateSharing slate={slate.current} />
      <SlateDrawer 
        open={slateDrawerOpen}
        onExport={(type, opts, cb) => {
          slate.current[type](opts, cb);
        }}
        getOrientation={() => {
          return slate.current.getOrientation();
        }}
        updateSlate={onSlateUpdate}
        slate={slate.current}
        onDrawerClose={(e) => { 
          dispatch({ type: "canvas", slateDrawerOpen: false })
        }}
      />
      <ExtensionsDrawer 
        open={extensionsDrawerOpen} 
        slate={slate.current} 
        updateSlate={onSlateUpdate}
        onDrawerClose={(e) => { dispatch({ type: "canvas", extensionsDrawerOpen: false }) }}
      />
      <CollaborationUsers slate={slate.current} />
    </RemoteCursors>
  );
};