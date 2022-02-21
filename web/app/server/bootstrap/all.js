import { CONSTANTS } from '../../imports/api/common/constants.js';
import { Claims, CachedImages, CachedImageTiming, SlateSnapshots, Collaboration } from '../../imports/api/common/models.js';

if (Claims.find({ _id: "admin" }).count() === 0) {
  Object.keys(CONSTANTS.claims).forEach((c) => {
    Claims.insert(CONSTANTS.claims[c]);
  });
}

if (Collaboration.find().count() === 0) {
  Collaboration.rawCollection().createIndex( { slateId: 1, dated: 1, instanceId: 1 });
}

//temporary for all slates
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

if (CachedImages.find().count() === 0) {
  CachedImages.rawCollection().createIndex( { url: 1, created: 1 });
  CachedImageTiming.rawCollection().createIndex({ provider: 1, filter: 1, lastSearched: 1 });
  // CachedImages.rawCollection().createIndex( { created: 1 }, { expireAfterSeconds: 60 * 60 * 24 } );
}

if (SlateSnapshots.find().count() === 0) {
  SlateSnapshots.rawCollection().createIndex({ slateId: 1, userId: 1, created: 1 });
  SlateSnapshots.rawCollection().createIndex({ created: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 }); // 3 rolling days of snapshots for every slate
}
