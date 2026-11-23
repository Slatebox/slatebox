import { Mongo } from 'meteor/mongo'

export const CreativeStates = new Mongo.Collection('creativeSlateStates')

export const NativePresentationStates = new Mongo.Collection('nativePresentationStates')

export function livePresentationTicket(shareId) {
  try { return JSON.parse(sessionStorage.getItem('slatebox.livePresentation.' + shareId)) } catch { return null }
}
