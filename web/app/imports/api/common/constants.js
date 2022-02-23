export const CONSTANTS = {
  ipWhitelist: ["127.0.0.1"],
  anonUserPwd: "ANONYMOUS",
  privateSlateLimit: 3,
  guestCollaboratorCookieId: "slatebox_guestCollaboratorId",
  defaultThemeId: "05e5acd816e2",
  methods: {
    users: {
      createAnonymous: "users.createAnonymous",
      getUserName: "users.getUserName",
      identify: "users.identify",
      get: "users.get",
      update: "users.update",
      resetPassword: "users.resetPassword",
      resendEnrollment: "users.resendEnrollment",
      invite: "users.invite",
      extractUserAndOrgNamesByResetToken: "users.extractUserAndOrgNamesByResetToken",
      changeRoles: "users.changeRoles",
      changeEmail: "users.changeEmail",
      delete: "users.delete",
      getSlateAccessUrl: "users.getSlateAccessUrl",
      getTokenByEmailForTesting: "users.getTokenByEmailForTesting",
      impersonate: "users.impersonate"
    },
    themes: {
      parseSlateIntoTheme: "themes.parseSlateIntoTheme",
      getPresetColors: "themes.getPresetColors",
      getThemes: "themes.getThemes",
      getPrivate: "themes.getPrivate",
      buildColorPalette: "themes.buildColorPalette"
    },
    slates: {
      update: "slates.update",
      generateShareId: "slates.generateShareId",
      getEmbedCode: "slates.getEmbedCode",
      get: "slates.get",
      scale: "slates.scale",
      translate: "slates.translate",
      scaleAndTranslate: "slates.scaleAndTranslate",
      remove: "slates.remove",
      getNonPublic: "slates.getNonPublic",
      archive: "slates.archive",
      searchBackgroundImages: "slates.searchBackgroundImages",
      cacheImage: "slates.cacheImage",
      createSnapshot: "slates.createSnapshot",
      getSnapshots: "slates.getSnapshots"
    },
    slateAccess: {
      get: "slateAccess.get"
    },
    chatWoot: {
      identifyUser: "chatWoot.identifyUser"
    },
    nounProject: {
      get: "nounProject.get"
    },
    collaborators: {
      create: "collaborators.getOrCreate"
    },
    utils: {
      base64StringFromRemoteUrl: "utils.base64StringFromRemoteUrl",
      optimizeSVG: "utils.optimizeSVG",
      createImage: "utils.createImage"
    },
    organizations: {
      create: "organizations.create",
      trackGuest: "organizations.trackGuest",
      getCancellationImplications: "organizations.getCancellationImplications",
      guestViewReport: "organizations.guestViewReport",
      delete: "organizations.delete"
    },
    comments: {
      toggleResolve: "messages.toggleResolve",
      remove: "messages.remove"
    },
    messages: {
      recreateMessagesForComment: "messages.recreateMessagesForComment"
    }
  },
  publications: {
    users: {
      me: "me"
    },
    collaboration: "collaboration",
    collaborators: "collaborators",
    mySlates: "slates",
    shareableSlate: "shareableSlate",
    communitySlates: "communitySlates",
    tags: "tags",
    messages: "messages",
    comments: "comments",
    organizations: "organizations",
    orgUsers: "orgUsers",
    orgUsersForGuest: "orgUsersForGuest",
    orgSlates: "orgSlates",
    claims: "claims",
    slateAccess: "slateAccess",
    permissions: "permissions",
    pricingTiers: "pricingTiers",
    templates: "templates",
    approvalRequests: "approvalRequests"
  },
  messageActionTypes: {
    slate: "slate",
    modal: "modal"
  },
  slateAccessPermissions: {
    none: { id: "NONE", description: "no access" },
    read: { id: "READ", description: "read" },
    comment: { id: "COMMENT", description: "comment" },
    edit: { id: "EDIT", description: "edit" }
  },
  claims: {
    uberMensch: { _id: "uberMensch", label: "Is Uber Alles", description: "Access to truly do everything", bound: ["*"] },
    admin: { _id: "admin", label: "Is Admin", description: "Access to do everything - full access to all slates and users.", bound: ["*"] },
    canViewUsers: { _id: "canViewUsers", label: "View Team Members", description: "Read-only access to view other team members" },
    canEditUsers: { _id: "canEditUsers", label: "Edit Team Members", description: "Edit other team members, including role assignment.", bound: ["canViewUsers"] },
    canAddUsers: { _id: "canAddUsers", label: "Invite New Team Members", description: "Send email invites to invite other team members", bound: ["canViewUsers"] },
    canRemoveUsers: { _id: "canRemoveUsers", label: "Remove Team Members", description: "Remove team members", bound: ["canViewUsers"] },
    // canViewSlates: { _id: "canViewSlates", label: "View Team Slates", description: "Read-only access to all member slates" },
    // canEditSlates: { _id: "canEditSlates", label: "Edit Team Slates", description: "Edit access to all member slates", bound: ["canViewSlates"] },
    canAddSlates: { _id: "canAddSlates", label: "Create Team Slates", description: "Create new slates on behalf of other members", bound: ["canViewSlates"] },
    canCopyTeamSlates: { _id: "canCopyTeamSlates", description: "Can copy a team slate for their own use", label: "Copy Team Slates", bound: ["canViewSlates"] },
    //canRemoveSlates: { _id: "canRemoveSlates", label: "Remove Team Slates", description: "Remove team member slates", bound: ["canViewSlates"] },
    canRemoveComments: { _id: "canRemoveComments", label: "Remove comments from slates", description: "Remove slate comments", bound: ["canRemoveComments"] },
  }
}