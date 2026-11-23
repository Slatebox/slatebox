import { Mongo } from 'meteor/mongo'

export const Organizations = new Mongo.Collection('organizations')
export const OrganizationSettings = new Mongo.Collection('organizationSettings')
