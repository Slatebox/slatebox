const CONSTANTS = {
  ipWhitelist: ['127.0.0.1'],
  guestCollaboratorCookieId: 'slatebox_guestCollaboratorId',
  defaultThemeId: '05e5acd816e2',
  googleDocsCookieToken: 'slatebox_googleDocsToken',
  fonts: [
    { val: 'arial', name: 'Arial' },
    { val: 'times-new-roman', name: 'Times New Roman' },
    { val: 'georgia', name: 'Georgia' },
    { val: 'courier-prime', name: 'Courier Prime' },
    { val: 'indie-flower', name: 'Indie Flower' },
    { val: 'abril-fatface', name: 'Abril Fatface' },
    { val: 'bangers', name: 'Bangers' },
    { val: 'caveat', name: 'Caveat' },
    { val: 'eb-garamond', name: 'EB Garamond' },
    { val: 'fredoka-one', name: 'Fredoka One' },
    { val: 'graduate', name: 'Graduate' },
    { val: 'gravitas-one', name: 'Gravitas One' },
    { val: 'ibm-plex-mono', name: 'IBM Plex Mono' },
    { val: 'ibm-plex-sans', name: 'IBM Plex Sans' },
    { val: 'ibm-plex-serif', name: 'IBM Plex Serif' },
    { val: 'lemon', name: 'Lemon' },
    { val: 'lora', name: 'Lora' },
    { val: 'nixie-one', name: 'Nixie One' },
    { val: 'noto-sans', name: 'Noto Sans' },
    { val: 'open-sans', name: 'Open Sans' },
    { val: 'poppins', name: 'Poppins' },
    { val: 'pt-sans', name: 'PT Sans' },
    { val: 'pt-sans-narrow', name: 'PT Sans Narrow' },
    { val: 'pt-serif', name: 'PT Serif' },
    { val: 'permanent-marker', name: 'Permanent Marker' },
    { val: 'rammetto-one', name: 'Rammetto One' },
    { val: 'roboto', name: 'Roboto' },
    { val: 'roboto-condensed', name: 'Roboto Condensed' },
    { val: 'roboto-mono', name: 'Roboto Mono' },
    { val: 'roboto-slab', name: 'Roboto Slab' },
    { val: 'rubik', name: 'Rubik' },
    { val: 'titan-one', name: 'Titan One' },
    { val: 'urbanist', name: 'Urbanist' },
  ],
  ai: {
    engines: {
      chatgpt: 'chatgpt',
    },
    types: {
      scratch: 'scratch',
      template: 'template',
      conversation: 'conversation',
    },
    state: {
      pending: 'pending',
      failed: 'failed',
      complete: 'complete',
    },
    role: {
      coordinator: 'coordinator',
      node: 'node',
      attribute: 'attribute',
    },
    layoutStrategy: {
      mindmap: {
        name: 'mindmap',
        display: 'Mind Map',
        description:
          'Engage the unicorns: Provide a concept you would like automagically mind-mapped',
      },
      template: {
        name: 'template',
        display: 'Template Auto-Fill',
        description:
          'Engage the unicorns: Automatically map stickes to a template',
      },
      url: {
        name: 'url',
        display: 'URL to Diagram',
        description: 'Engage the unicorns: Turn a URL into a diagram',
      },
      infographic: {
        name: 'infographic',
        display: 'Infographic',
        description: 'Engage the unicorns: Turn an idea into an infographic',
        comingSoon: true,
      },
    },
    wordsPerNode: {
      5: {
        display: '5 words',
        description: 'Leave lots to the imagination',
      },
      15: {
        display: '15 words',
        description: 'Provide a brief level of detail',
      },
      25: {
        display: '25 words',
        description: 'Provide a moderate level of detail',
      },
      35: {
        display: '35 words',
        description: 'Provide a comprehensive level of detail',
      },
      45: {
        display: '45 words',
        description: 'Provide a throrough level of detail',
      },
      55: {
        display: '55 words',
        description: 'Provide a meticulous level of detail',
      },
      65: {
        display: '65 words',
        description: 'Provide a exhaustive level of detail',
      },
    },
    levelOfDetail: {
      1: {
        display: 'Minimal',
        description: 'Provide a minimal level of detail',
      },
      2: { display: 'Basic', description: 'Digs in a little more' },
      3: {
        display: 'Moderate',
        description: 'Moderately deep information',
      },
      4: {
        display: 'Comprehensive',
        description: 'A pretty deep understanding',
      },
      5: {
        display: 'Thorough',
        description: 'Attempting to cover all the information',
      },
      6: {
        display: 'Meticulous',
        description: 'OCD Much? Here you go.',
      },
      7: {
        display: 'Exhaustive',
        description: 'OK. This is the best we can do.',
      },
    },
    tone: {
      neutral: {
        name: 'neutral',
        display: 'Neutral',
        description:
          'A straightforward and factual tone, without any particular emotional connotation.',
      },
      informative: {
        name: 'informative',
        display: 'Informative',
        description:
          'A helpful and explanatory tone, geared towards conveying information clearly and accurately.',
      },
      playful: {
        name: 'playful',
        display: 'Playful',
        description:
          'A lighthearted and whimsical tone, aimed at making the conversation more fun and enjoyable.',
      },
      enthusiastic: {
        name: 'enthusiastic',
        display: 'Enthusiastic',
        description:
          'A tone of excitement and enthusiasm, designed to convey a sense of energy and positivity.',
      },
      satirical: {
        name: 'satirical',
        display: 'Satirical',
        description:
          'A tone that satirizes the subject matter as "legitimate".',
      },
      cynical: {
        name: 'cynical',
        display: 'Cynical',
        description:
          'A tone that expresses skepticism and doubt, often with a touch of irony or sarcasm.',
      },
      empathetic: {
        name: 'empathetic',
        display: 'Empathetic',
        description:
          "A tone that conveys understanding and compassion, geared towards acknowledging the emotions and concerns of the person you're speaking with.",
      },
      philosophical: {
        name: 'philosophical',
        display: 'Philosophical',
        description:
          'A tone that explores abstract ideas and concepts, often with a contemplative and reflective quality.',
      },
      witty: {
        name: 'witty',
        display: 'Witty',
        description:
          'A tone that uses clever wordplay and humor to make a point or lighten the mood.',
      },
      confident: {
        name: 'confident',
        display: 'Confident',
        description:
          'A tone that conveys certainty and authority, designed to inspire trust and confidence in your ideas.',
      },
      creative: {
        name: 'creative',
        display: 'Creative',
        description:
          'A tone that encourages experimentation and innovation, geared towards exploring new and unconventional ideas.',
      },
    },
    audit: {
      types: {
        unableToSaveNode: 'unableToSaveNode',
        unableToSaveAttribNode: 'unableToSaveAttribNode',
        unableToParseFinalJson: 'unableToParseFinalJson',
        generalError: 'generalError',
      },
    },
  },
  systemSettings: {
    videoMetaData: 'videoMetaData',
    welcomeMessage: 'welcomeMessage',
    youTubeAudioToNotesMessage: 'youTubeAudioToNotesMessage',
    presentationPrompts: 'presentationPrompts',
  },
  methods: {
    videoHelpGuideLikes: {
      get: 'videoHelpGuideLikes.get',
      post: 'videoHelpGuideLikes.post',
    },
    videoHelpGuides: {
      get: 'videoHelpGuides.get',
    },
    auth: {
      isAuthenticated: 'auth.isAuthenticated',
    },
    // The consent page for an app connecting over OAuth (server/oauth/meteor.js)
    oauth: {
      describe: 'oauth.describe',
      decide: 'oauth.decide',
    },
    apiTokens: {
      create: 'apiTokens.create',
      list: 'apiTokens.list',
      revoke: 'apiTokens.revoke',
    },
    // AI settings (server/actions/ai-*.mjs): read, change and test AI connections
    ai: {
      get: 'ai.get',
      update: 'ai.update',
      check: 'ai.check',
    },
    instance: {
      describe: 'instance.describe',
    },
    account: {
      get: 'account.get',
    },
    users: {
      createAnonymous: 'users.createAnonymous',
      identify: 'users.identify',
      verificationMailAvailable: 'users.verificationMailAvailable',
      sendVerification: 'users.sendVerification',
      search: 'users.search',
      certifyForEducation: 'users.certifyForEducation',
      requestEducationCertification: 'users.requestEducationCertification',
      get: 'users.get',
      update: 'users.update',
      resetPassword: 'users.resetPassword',
      resendEnrollment: 'users.resendEnrollment',
      invite: 'users.invite',
      extractUserAndOrgNamesByResetToken:
        'users.extractUserAndOrgNamesByResetToken',
      changeRoles: 'users.changeRoles',
      changeEmail: 'users.changeEmail',
      delete: 'users.delete',
      getSlateAccessUrl: 'users.getSlateAccessUrl',
      getTokenByEmailForTesting: 'users.getTokenByEmailForTesting',
      allowedInPrivateBeta: 'users.allowedInPrivateBeta',
      isMasterUser: 'users.isMasterUser',
      getHelpStatus: 'users.getHelpStatus',
      setHelpStatus: 'users.setHelpStatus',
      generateSpecialUseLoginToken: 'users.generateSpecialUseLoginToken',
      attemptLoginWithLink: 'users.attemptLoginWithLink',
      getConversationWelcome: 'users.getConversationWelcome',
    },
    images: {
      getColors: 'images.getColors',
      removeImage: 'images.removeImage',
      search: 'images.search',
    },
    themes: {
      parseSlateIntoTheme: 'themes.parseSlateIntoTheme',
      getPresetColors: 'themes.getPresetColors',
      getThemes: 'themes.getThemes',
      buildColorPalette: 'themes.buildColorPalette',
    },
    iconPacks: {
      get: 'iconPacks.get',
      update: 'iconPacks.update',
      delete: 'iconPacks.delete',
      removeIcon: 'iconPacks.removeIcon',
    },
    slates: {
      update: 'slates.update',
      generateShareId: 'slates.generateShareId',
      getEmbedCode: 'slates.getEmbedCode',
      get: 'slates.get',
      scale: 'slates.scale',
      translate: 'slates.translate',
      remove: 'slates.remove',
      searchBackgroundImages: 'slates.searchBackgroundImages',
      cacheImage: 'slates.cacheImage',
      createSnapshot: 'slates.createSnapshot',
      getSnapshots: 'slates.getSnapshots',
    },
    slateAccess: {
      get: 'slateAccess.get',
      configureLink: 'slateAccess.configureLink',
      configureMember: 'slateAccess.configureMember',
      recipients: 'slateAccess.recipients',
    },
    chatWoot: {
      identifyUser: 'chatWoot.identifyUser',
    },
    nounProject: {
      get: 'nounProject.get',
    },
    collaborators: {
      init: 'collaborators.init',
    },
    utils: {
      base64StringFromRemoteUrl: 'utils.base64StringFromRemoteUrl',
      optimizeSVG: 'utils.optimizeSVG',
      getCloudLink: 'utils.getCloudLink',
      urlExists: 'utils.urlExists',
    },
    wallet: {
      quote: 'wallet.quote',
      createTopUp: 'wallet.createTopUp',
      confirmTopUp: 'wallet.confirmTopUp',
      refund: 'wallet.refund',
      charges: 'wallet.charges',
    },
    pro: {
      checkout: 'pro.checkout',
      confirm: 'pro.confirm',
      portal: 'pro.portal',
      refresh: 'pro.refresh',
      // managed in the pay sheet (server/pro-manage.mjs)
      preview: 'pro.preview',
      switchInterval: 'pro.switchInterval',
      renewal: 'pro.renewal',
      cardSession: 'pro.cardSession',
      cardConfirm: 'pro.cardConfirm',
      actionSecret: 'pro.actionSecret',
      invoices: 'pro.invoices',
    },
    meter: {
      summary: 'meter.summary',
      adminSummary: 'meter.adminSummary',
      setBudget: 'meter.setBudget',
      setFreeStopped: 'meter.setFreeStopped',
    },
    keys: {
      save: 'keys.save',
      remove: 'keys.remove',
      list: 'keys.list',
    },
    organizations: {
      create: 'organizations.create',
      trackGuest: 'organizations.trackGuest',
      getCancellationImplications: 'organizations.getCancellationImplications',
      delete: 'organizations.delete',
      get: 'organizations.get',
    },
    comments: {
      toggleResolve: 'messages.toggleResolve',
      remove: 'messages.remove',
    },
    messages: {
      recreateMessagesForComment: 'messages.recreateMessagesForComment',
    },
    googleDocs: {
      createAuthUrl: 'googleDocs.createAuthUrl',
      getToken: 'googleDocs.getToken',
      export: 'googleDocs.export',
    },
    daily: {
      join: 'daily.join',
      leave: 'daily.leave',
      useVideo: 'daily.useVideo',
    },
    openai: {
      chat: 'openai.chat',
      welcome: 'openai.welcome',
      routeSlateMessage: 'openai.routeSlateMessage',
      operationCompleted: 'openai.operationCompleted',
      fetchOriginalPrompt: 'openai.fetchOriginalPrompt',
      deleteAIContent: 'openai.deleteAIContent',
    },
    presentations: {
      analyze: 'presentations.analyze',
      get: 'presentations.get',
      publish: 'presentations.publish',
      unpublish: 'presentations.unpublish',
      update: 'presentations.update',
      load: 'presentations.load',
    },
    stabilityai: {
      generate: 'stabilityai.generate',
    },
    chatIntentions: {
      save: 'chatIntentions.save',
      delete: 'chatIntentions.delete',
    },
    organizationSettings: {
      save: 'organizationSettings.save',
      get: 'organizationSettings.get',
      getAll: 'organizationSettings.getAll',
      getByQuery: 'organizationSettings.getByQuery',
      remove: 'organizationSettings.remove',
      deletePreset: 'organizationSettings.deletePreset',
    },
    invites: {
      // ... existing code ...
    },
  },
  organizationSettings: {
    keys: {
      FAVICON_URL: 'faviconUrl',
      BRANDING_PRESETS: 'brandingPresets',
      PRESENTATION_MENU_BG_COLOR: 'presentationMenuBgColor',
      PRESENTATION_CONTROLS_COLOR: 'presentationControlsColor',
    },
  },
  publications: {
    users: {
      me: 'me',
    },
    collaboration: 'collaboration',
    mySlates: 'slates',
    shareableSlate: 'shareableSlate',
    communitySlates: 'communitySlates',
    tags: 'tags',
    messages: 'messages',
    comments: 'comments',
    organizations: 'organizations',
    orgUsers: 'orgUsers',
    orgUsersForGuest: 'orgUsersForGuest',
    orgSlates: 'orgSlates',
    claims: 'claims',
    slateAccess: 'slateAccess',
    permissions: 'permissions',
    templates: 'templates',
    approvalRequests: 'approvalRequests',
    iconPacks: 'iconPacks',
    aiContent: 'aiContent',
    slateOperationRuns: 'slateOperationRuns',
    transcripts: 'transcripts,',
    chatIntentions: 'chatIntentions',
    organizationSettings: 'organizationSettings',
  },
  messageTypes: {
    system: 'system',
    chat: 'chat',
    ai: 'ai',
  },
  messageActionTypes: {
    slate: 'slate',
    modal: 'modal',
  },
  slateAccessPermissions: {
    none: { id: 'NONE', description: 'no access' },
    read: { id: 'READ', description: 'read' },
    comment: { id: 'COMMENT', description: 'comment' },
    edit: { id: 'EDIT', description: 'edit' },
  },
  claims: {
    uberMensch: {
      _id: 'uberMensch',
      label: 'Is Uber Alles',
      description: 'Access to truly do everything',
      bound: ['*'],
    },
    admin: {
      _id: 'admin',
      label: 'Is Admin',
      description:
        'Access to do everything - full access to all slates and users.',
      bound: ['*'],
    },
    canViewUsers: {
      _id: 'canViewUsers',
      label: 'View Team Members',
      description: 'Read-only access to view other team members',
    },
    canEditUsers: {
      _id: 'canEditUsers',
      label: 'Edit Team Members',
      description: 'Edit other team members, including role assignment.',
      bound: ['canViewUsers'],
    },
    canAddUsers: {
      _id: 'canAddUsers',
      label: 'Invite New Team Members',
      description: 'Send email invites to invite other team members',
      bound: ['canViewUsers'],
    },
    canRemoveUsers: {
      _id: 'canRemoveUsers',
      label: 'Remove Team Members',
      description: 'Remove team members',
      bound: ['canViewUsers'],
    },
    // canViewSlates: { _id: "canViewSlates", label: "View Team Slates", description: "Read-only access to all member slates" },
    // canEditSlates: { _id: "canEditSlates", label: "Edit Team Slates", description: "Edit access to all member slates", bound: ["canViewSlates"] },
    canAddSlates: {
      _id: 'canAddSlates',
      label: 'Create Team Slates',
      description: 'Create new slates on behalf of other members',
      bound: ['canViewSlates'],
    },
    canCopyTeamSlates: {
      _id: 'canCopyTeamSlates',
      description: 'Can copy a team slate for their own use',
      label: 'Copy Team Slates',
      bound: ['canViewSlates'],
    },
    // canRemoveSlates: { _id: "canRemoveSlates", label: "Remove Team Slates", description: "Remove team member slates", bound: ["canViewSlates"] },
    canRemoveComments: {
      _id: 'canRemoveComments',
      label: 'Remove comments from slates',
      description: 'Remove slate comments',
      bound: ['canRemoveComments'],
    },
  },
  educationCertification: {
    requestStatuses: {
      CERTIFIED: 'CERTIFIED',
      PENDING: 'PENDING',
    },
  },
}

export default CONSTANTS
