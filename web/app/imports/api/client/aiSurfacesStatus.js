// The browser side of ai.surfaces.status (server/ai-control/index.mjs): whether each AI surface is
// on for this person, and the message to show when an administrator turned it off. No models,
// prompts or connections ever reach the page. An entry point (Ask Slatebox, ShapeMaker, Present,
// Invite agent, ...) reads it to hide or explain its control; until a surface can be turned off
// (AI control S4) every surface reads as on.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { useTracker } from 'meteor/react-meteor-data'

export const AISurfacesStatus = new Mongo.Collection('aiSurfacesStatus')
const ON = Object.freeze({ enabled: true, message: null })

/** { enabled, message } for one surface (a catalogue id such as 'shape'); on until it says otherwise. */
export function useAISurface(surface) {
  return useTracker(() => {
    if (!Meteor.userId()) return ON
    Meteor.subscribe('ai.surfaces.status')
    const status = AISurfacesStatus.findOne('status')
    if (!status) return ON
    if (status.aiEnabled === false) return { enabled: false, message: status.message }
    return status.surfaces?.[surface] || ON
  }, [surface])
}
