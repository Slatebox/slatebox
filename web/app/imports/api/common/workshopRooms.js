import { Mongo } from 'meteor/mongo'

// The server publishes the model and effective access separately for each connection.
export const WorkshopRooms = new Mongo.Collection('workshopRooms')
