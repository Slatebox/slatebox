import { Meteor } from 'meteor/meteor';

function makePublication(name, fn) {
  // console.log('calling make publication ', name);
  Meteor.publish({ [name]: fn });

  return (...args) => {
    Meteor.publish(name, ...args);
  };
}

export default makePublication;