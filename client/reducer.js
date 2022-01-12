const initialState = {};

// Use the initialState as a default value
export default function appReducer(state = initialState, action) {
  // The reducer normally looks at the action type field to decide what happens
  switch (action.type) {
    // Do something here based on the different types of actions
    case "collaborator": {
      //console.log("set collaborator in canvas")
      return Object.assign(state, { collaborator: action.collaborator });
    }
    case "embed":
    case "canvas":
    case "googleimages":
    case "nounproject":
    case "nodedrawer":
    case "registration":
    case "payment":
    case "displayslates": {
      let obj = {};
      Object.keys(action).filter(a => a !== 'type').forEach(a => {
        obj[a] = action[a];
      });
      const newState =  Object.assign(state, obj);
      return newState; //Object.assign(state, obj);
      // return {
      //   ...state,
      //   obj
      // };
    }
    default:
      // If this reducer doesn't recognize the action type, or doesn't
      // care about this specific action, return the existing state unchanged
      return state
  }
}