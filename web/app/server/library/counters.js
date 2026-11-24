// Server only: the library's daily allowances and who has used what (uses.mjs). Never published.
import { Mongo } from 'meteor/mongo'

export const LibraryCounters = new Mongo.Collection('libraryCounters')
