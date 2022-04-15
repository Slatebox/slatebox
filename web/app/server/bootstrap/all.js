import CONSTANTS from '../../imports/api/common/constants'
import {
  Claims,
  CachedImages,
  CachedImageTiming,
  SlateSnapshots,
  PricingTiers,
  Collaboration,
  Slates,
} from '../../imports/api/common/models'
import themeGenerator from './themeGenerator.json'

if (Claims.find({ _id: 'admin' }).count() === 0) {
  Object.keys(CONSTANTS.claims).forEach((c) => {
    Claims.insert(CONSTANTS.claims[c])
  })
}

if (Collaboration.find().count() === 0) {
  Collaboration.rawCollection().createIndex({
    slateId: 1,
    dated: 1,
    instanceId: 1,
  })
}

// temporary for all slates
// let c = 0;
// for (let s of Slates.find({}).fetch()) {
//   c++;
//   console.log("updating slate", s._id, c);
//   if (s.options.name && s.options.name.trim() !== "") {
//     Slates.update({ _id: s._id }, { $set: {
//       "options.searchName": createEdgeNGrams(s.options.name),
//       "options.searchDescription": createEdgeNGrams(s.options.description),
//       "options.searchText": s.nodes && s.nodes.length > 0 ? createEdgeNGrams(s.nodes.map(n => n.options.text).join(" ")) : ""
//     }});
//   }
// }

// if (Slates.find().count() === 0) {
//   // {
// 	// 	"v" : 2,
// 	// 	"key" : {
// 	// 		"_fts" : "text",
// 	// 		"_ftsx" : 1
// 	// 	},
// 	// 	"name" : "options.name_text_options.description_text_nodes.options.text_text",
// 	// 	"weights" : {
// 	// 		"nodes.options.text" : 1,
// 	// 		"options.description" : 1,
// 	// 		"options.name" : 1
// 	// 	},
// 	// 	"default_language" : "english",
// 	// 	"language_override" : "language",
// 	// 	"ns" : "slatebox.slates",
// 	// 	"textIndexVersion" : 3
// 	// },
// }

const tg = Slates.findOne({ isThemeGenerator: true })
if (!tg) {
  Slates.insert(themeGenerator)
}

if (CachedImages.find().count() === 0) {
  CachedImages.rawCollection().createIndex({ url: 1, created: 1 })
  CachedImageTiming.rawCollection().createIndex({
    provider: 1,
    filter: 1,
    lastSearched: 1,
  })
  // CachedImages.rawCollection().createIndex( { created: 1 }, { expireAfterSeconds: 60 * 60 * 24 } );
}

if (SlateSnapshots.find().count() === 0) {
  SlateSnapshots.rawCollection().createIndex({
    slateId: 1,
    userId: 1,
    created: 1,
  })
  SlateSnapshots.rawCollection().createIndex(
    { created: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 3 }
  ) // 3 rolling days of snapshots for every slate
}

const saasTiers = [
  {
    title: 'Forever Free Team',
    _id: 'free',
    monthly: {
      priceId: 'free',
      price: 0,
    },
    yearly: {
      priceId: 'free',
      price: 0,
    },
    description: [
      `${CONSTANTS.privateSlateLimit} Private Slates`,
      'Unlimited PUBLIC slates',
      'Unlimited shapes',
      'Unlimited PUBLIC Collaboration',
      '5 Guest Day Passes/Month',
    ],
    buttonText: 'Continue using',
    headerText: 'Forever Free Team',
    buttonVariant: 'outlined',
    guestViewsPerMonth: 5,
  },
  {
    title: 'Solo Practitioner',
    _id: 'solo',
    isSolo: true,
    monthly: {
      priceId: 'price_0Kodbg0kGBdxtSKoEpnTO5hD',
      price: 4,
    },
    yearly: {
      priceId: 'solo_yearly',
      price: 3,
    },
    description: [
      'Unlimited PRIVATE slates',
      'Integrated image search',
      'Unlimited shapes',
      'Unlimited Collaboration:',
      '(public for non solo users, private for other solo users)',
      '25 Guest Day Passes/Month',
    ],
    buttonText: 'Go Solo',
    welcomeMessage: `Welcome to Slatebox Solo Edition! You now have unlimited private slates, integrated image search, unlimited vector shapes, unlimited collaboration (public for non solo users, private for all others), and 25 guest day passes/month.`,
    headerText: 'Solo Practitioner',
    buttonVariant: 'outlined',
    guestViewsPerMonth: 25,
  },
  {
    title: 'Team',
    _id: 'team',
    subheader: 'Most popular',

    hasStar: true,
    requiresOrgId: true,
    useForProOrgGuestViewCount: true,
    monthly: {
      priceId: 'price_0KodYY0kGBdxtSKoPwT6nXf5',
      price: 4,
    },
    yearly: {
      priceId: 'price_0KodZr0kGBdxtSKoK9wdfH0g',
      price: 3,
    },
    description: [
      'Unlimited PRIVATE slates',
      'Integrated image search',
      'Unlimited shapes',
      'Unlimited PRIVATE team collaboration',
      'Unlimited PUBLIC collaboration',
      '25 Guest Day Passes/Month',
    ],
    buttonText: 'Get Started Today',
    welcomeMessage: `Welcome to Slatebox Team Edition! Your whole team now has unlimited private slates, unlimited private team collaboration, integrated image search, and unlimited vector shapes. Your organization can host up to 25 guests with private collaboration every month.`,
    headerText: 'Team',
    buttonVariant: 'contained',
    guestViewsPerMonth: 25,
  },
  {
    title: 'Enterprise',
    _id: 'enterprise',
    monthly: {
      priceId: 'custom',
      price: 'Custom',
    },
    yearly: {
      priceId: 'custom',
      price: 'Custom',
    },
    description: [
      'All of Team...',
      'Tailored to your org',
      'Custom implementation',
      'Always up-to-date',
    ],
    action: 'contact',
    buttonText: 'Contact Us',
    buttonVariant: 'outlined',
  },
]

const selfHostedTiers = [
  {
    title: 'Community Edition',
    _id: 'community_edition',
    subheader: 'Open-Source Licensed',
    monthly: {
      priceId: 0,
      price: 0,
    },
    yearly: {
      priceId: 0,
      price: 0,
    },
    description: [
      'Host On Your Servers',
      'Unlimited PRIVATE slates',
      'Integrated image search',
      'Unlimited shapes',
      'Unlimited PRIVATE Collaborators',
    ],
    buttonText: 'Contact Us',
    action: 'github',
    buttonVariant: 'outlined',
  },
  {
    title: 'Community Bronze',
    _id: 'bronze',
    subheader: 'Solid support foundation',
    monthly: {
      priceId: 'community_bronze',
      price: 39,
    },
    yearly: {
      priceId: 'community_bronze',
      price: 29,
    },
    description: [
      'All of Community Edition, PLUS:',
      'Installation & ongoing support',
      'Monthly Software Updates',
      'Priority Email Support',
    ],
    buttonText: 'Contact Us',
    action: 'contact',
    buttonVariant: 'outlined',
  },
  {
    title: 'Community Silver',
    _id: 'silver',
    subheader: 'Most Popular',
    hasStar: true,
    monthly: {
      priceId: 'community_silver',
      price: 49,
    },
    yearly: {
      priceId: 'community_silver',
      price: 39,
    },
    description: [
      'All of Community Edition, PLUS:',
      'Installation & ongoing support',
      'Real-Time Software Updates',
      'Priority Email Support',
      'Screen Sharing Support',
    ],
    buttonText: 'Contact Us',
    action: 'contact',
    buttonVariant: 'contained',
  },
  {
    title: 'Community Gold',
    _id: 'gold',
    monthly: {
      priceId: 'community_gold',
      price: 59,
    },
    yearly: {
      priceId: 'community_gold',
      price: 49,
    },
    description: [
      'All of Community Edition, PLUS:',
      'Installation & ongoing support',
      'Real-Time Software Updates',
      'Priority Email Support',
      'Screen Sharing Support',
      'Slatebox Cloud',
    ],
    buttonText: 'Contact Us',
    action: 'contact',
    buttonVariant: 'outlined',
  },
]

if (!PricingTiers.findOne()) {
  saasTiers.forEach((s) => {
    s.type = 'saas'
    PricingTiers.insert(s)
  })
  selfHostedTiers.forEach((s) => {
    s.type = 'self-hosted'
    PricingTiers.insert(s)
  })
}
