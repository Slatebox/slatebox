import React, { useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Messages } from '../../api/common/models';
import { useDispatch } from 'react-redux';
import { useHistory } from "react-router-dom";
import confirmService from '../../ui/common/confirm';
import { CONSTANTS } from '../../api/common/constants';
import { useTheme } from '@material-ui/core';

export const MessageListener = (props) => {

  const history = useHistory(props);
  const theme = useTheme();

  async function message(title, body, onOK) {
    console.log("showing dialog", title, body);
    await confirmService.show({
      theme: theme,
      title: title,
      message: body,
      actionItems: [
        { label: "OK", return: false}
      ]
    });
    if (onOK) {
      //redirect to page
      history.push(onOK);
    }
  }

  let all = [];
  useTracker(() => {
    //get all messages
    Meteor.subscribe(CONSTANTS.publications.messages);
    if (Messages.find({ read: false, priority: 10 }, { sort: { timestamp: -1 } }).count() > 0) {
      //do something with the messages - priority = 10 means a global dispatch, effect='celebration' means baloons or something!
      all = Messages.find({ read: false, priority: 10 }).fetch().sort((a,b) => { return a.timestamp - b.timestamp });
      console.log("found messages to notify user", all);
      let celebrate = all.some(m => m.effect === "celebrate");
      if (all.length > 0) {
        message(all[0].title, all.map(a => a.text).join(", "), all[0].onOK);
        //dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: false, text: , severity: "success", autoHide: 60000 } });
        all.forEach(a => {
          Messages.update({ _id: a._id }, { $set: { read: true }});
        });
      }
    }
  });

  return null;
}