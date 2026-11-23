import { Meteor } from 'meteor/meteor'
import promisify from './promisify'
import CONSTANTS from '../common/constants'

const urlExists = async (url) =>
  Meteor.callAsync(CONSTANTS.methods.utils.urlExists, url)

export default urlExists
