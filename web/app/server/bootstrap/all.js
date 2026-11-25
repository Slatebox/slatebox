/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'

import {
  Claims,
  CachedImages,
  CachedImageTiming,
  SlateSnapshots,
  Collaboration,
  Slates,
  SystemSettings,
  VideoHelpGuides,
  LoginLinks,
  Tags,
} from '../../imports/api/common/models'
import proConTemplate from './proConTemplate.json'
import { templateCategories } from './template-categories.mjs'

if ((await Claims.find({ _id: 'admin' }).countAsync()) === 0) {
  for (const c of Object.keys(CONSTANTS.claims)) {
    await Claims.insertAsync(CONSTANTS.claims[c])
  }
}

if ((await Collaboration.find().countAsync()) === 0) {
  Collaboration.rawCollection().createIndex({
    slateId: 1,
    dated: 1,
    instanceId: 1,
  })
}

// The old first-visit welcome dialog (its help-icon tour and video) is gone; a database that still
// holds its text drops it here, so nothing can show it again.
await SystemSettings.removeAsync({ _id: 'welcomeMessage' })

await SystemSettings.removeAsync({
  _id: CONSTANTS.systemSettings.youTubeAudioToNotesMessage,
})
if (
  !(await SystemSettings.findOneAsync({
    _id: CONSTANTS.systemSettings.youTubeAudioToNotesMessage,
  }))
) {
  await SystemSettings.insertAsync({
    _id: CONSTANTS.systemSettings.youTubeAudioToNotesMessage,
    title: `Dynamically create notes from YouTube audio.`,
    body: `<p>In order to dynamically create notes from an audio source, you need to do 2 simple things:</p><ol><li><a style='color:#fff;cursor:pointer' href='{{audioUrl}}' download='slatebox_youtube_audio_{{slateId}}.mp3'>Click here to download the YouTube audio mp3.</a> Once saved, start playing it and return to the slate.</li><li>Click the huddle toggle switch to turn on your microphone to listen for external audio. <p><img src='https://files.slatebox.com/sb_huddle_loop.gif'/></p></li></ol><p>As the audio is playing in the background, Slatebox will begin producing notes on a mind-map based on the audio source.<p>If you have any questions click the contact support icon <img src='https://files.slatebox.com/contact_support.png' style='height:25px;'/> in the upper right.</p>`,
  })
}

try {
  LoginLinks.rawCollection().createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 60 * 15, background: true }
  ) // expire in 15 minutes
} catch (err) {
  console.error('Unable to create index on login links', err)
}

if (!(await VideoHelpGuides.findOneAsync())) {
  for (const v of [
    {
      path: '/',
      title: "Welcome to the dashboard! Let's make your first AI slate.",
      id: 'sqoPn7JYfx61tRM8DkCUXa',
    },
    {
      path: '/canvas',
      title: 'Introduction to the node.',
      id: '6zPm2mBFgifiohi2xzZkZF',
    },
  ]) {
    await VideoHelpGuides.insertAsync(v)
  }
  for (const ss of [
    {
      type: CONSTANTS.systemSettings.videoMetaData,
      path: '/',
      title: 'Welcome To Your Dashboard!',
    },
    {
      type: CONSTANTS.systemSettings.videoMetaData,
      path: '/canvas',
      title:
        'Welcome to the Canvas - creating slates is easy, check out these guides!',
    },
  ]) {
    await SystemSettings.insertAsync(ss)
  }
}

// The included amounts for AI and calls (Slatebox Pro, or free before its date) live in SystemSettings 'metering' (server/metering, migration M1).

// temporary for all slates
// let c = 0;
// for (let s of Slates.find({}).fetchAsync()) {
//   c++;
//   console.log("updating slate", s._id, c);
//   if (s.options.name && s.options.name.trim() !== "") {
//     await Slates.updateAsync({ _id: s._id }, { $set: {
//       "options.searchName": createEdgeNGrams(s.options.name),
//       "options.searchDescription": createEdgeNGrams(s.options.description),
//       "options.searchText": s.nodes && s.nodes.length > 0 ? createEdgeNGrams(s.nodes.map(n => n.options.text).join(" ")) : ""
//     }});
//   }
// }

// if (Slates.find().countAsync() === 0) {
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

// Curated starter template: Pro/Con Analysis. The welcome assistant only
// advertises the template catalog when it is NON-empty (see
// welcome-template-routing); seeding one approved template re-arms the full
// template product: expandTemplates lists it, previewTemplate + load flow
// render it, and the populate kick carries real category content.
const proCon = await Slates.findOneAsync({ shareId: proConTemplate.shareId })
if (!proCon) {
  await Slates.insertAsync(proConTemplate)
} else if (
  proCon.options?.templatePrompt !== proConTemplate.options.templatePrompt
) {
  // Seed JSON is the SOURCE OF TRUTH for the shipped template's kickoff
  // text. Without this sync the first-seeded DB copy froze forever (the
  // live docs carried the pre-rewrite prompt on both test and prod until
  // iter24). Scope is pinned to the single master template doc — user
  // canvas copies of templatePrompt are never touched.
  await Slates.updateAsync(
    { shareId: proConTemplate.shareId, 'options.isTemplate': true },
    {
      $set: {
        'options.templatePrompt': proConTemplate.options.templatePrompt,
      },
    }
  )
}

if ((await CachedImages.find().countAsync()) === 0) {
  CachedImages.rawCollection().createIndex({ url: 1, created: 1 })
  CachedImageTiming.rawCollection().createIndex({
    provider: 1,
    filter: 1,
    lastSearched: 1,
  })
  // CachedImages.rawCollection().createIndex( { created: 1 }, { expireAfterSeconds: 60 * 60 * 24 } );
}

if ((await SlateSnapshots.find().countAsync()) === 0) {
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

if (!(await Tags.findOneAsync())) {
  Tags.rawCollection().insertMany(templateCategories)
}
