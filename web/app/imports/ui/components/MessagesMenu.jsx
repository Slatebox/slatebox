import React from 'react';
import { Meteor } from 'meteor/meteor'
import { useDispatch, useSelector } from 'react-redux'
import { useTracker } from 'meteor/react-meteor-data';
import Menu from '@material-ui/core/Menu';
import MenuItem from '@material-ui/core/MenuItem';
import IconButton from '@material-ui/core/IconButton';
import Typography from '@material-ui/core/Typography';
import { Messages, SlateAccess, Slates } from '../../api/common/models';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import InfoIcon from '@material-ui/icons/Info';
import AnnouncementIcon from '@material-ui/icons/Announcement';
import NotificationsIcon from '@material-ui/icons/Notifications';
import Badge from '@material-ui/core/Badge';
import { CONSTANTS } from '../../api/common/constants';
import { Link as RouterLink, useHistory } from "react-router-dom";
import Link from "@material-ui/core/Link";
import Tooltip from '@material-ui/core/Tooltip';
import Button from '@material-ui/core/Button';

import { promisify } from '../../api/client/promisify.js';

import { useTheme } from '@material-ui/core/styles';
import Box from '@material-ui/core/Box';

export const MessagesMenu = (props) => {
  const theme = useTheme();
  let messages = useTracker(() => {
    return Messages.find({}, {sort: { timestamp: -1 } }).fetch();
  });

  const [anchorEl, setAnchorEl] = React.useState(null);
  const showMenu = (e) => {
    setAnchorEl(e.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(null);
    messages.forEach(m => Messages.update({ _id: m._id }, { $set: { read: true } } ));
  };

  function formatTimestamp(timestamp) {
    return `${new Date(timestamp).toLocaleDateString()} ${new Date(timestamp).toLocaleTimeString()}`;
  }

  function RenderMessage(props) {
    const [url, setUrl] = React.useState(null);
    async function getAccessUrl() {
      const gurl = await promisify(Meteor.call, CONSTANTS.methods.users.getSlateAccessUrl, { userId: Meteor.userId(), slateId: props.message.slateId, nodeId: props.message.nodeId });
      setUrl(gurl);
    }
    if (props.message.action) {
      switch (props.message.action.type) {
        case CONSTANTS.messageActionTypes.slate: {
          //need to go get potential accessKey for this user
          getAccessUrl();
          return (<>
            {url ?
              <Tooltip title={props.message.action.toolTip}>
                <Link component={RouterLink} to={url} style={{ color: props.message.read ? "#fff" : theme.palette.secondary.main }} variant="body2">
                  <Typography variant="inherit" variant="inherit">
                    {props.message.text}
                  </Typography>
                </Link>
              </Tooltip>
              :
              <Box>
                <Typography variant="overline" style={{ color: theme.palette.error.main }}>
                  NOTE: Sorry, you no longer have access to this slate.
                </Typography>
                <Typography variant="inherit" variant="inherit">
                  Original Comment: {props.message.text}
                </Typography>
              </Box>
            }
          </>);
        }
        case CONSTANTS.messageActionTypes.modal: {
          return (
            <Tooltip title={props.message.toolTip}>
              <Button component={Link} onClick={async e => {
                const result = await confirmService.show({
                  theme: theme,
                  title: props.message.modalTitle,
                  message: props.message.modalBody
                });
               }}>
                <Typography variant="inherit" color={props.message.read ? "secondary" : ""}>
                  {props.message.text}
                </Typography>
              </Button>
            </Tooltip>
          );
        }
      }
    } else {
      return (<Typography variant="inherit" color={props.message.read ? "" : "secondary"}>{formatTimestamp(props.message.timestamp)} - {props.message.text}</Typography>);
    }
  }

  return (
    <>
      <IconButton aria-controls="messages-menu" aria-haspopup="true" color="inherit" onClick={showMenu}>
        <Badge badgeContent={Messages.find({ read: false }).count()} color="secondary" >
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Menu
        id="messages-menu"
        anchorEl={anchorEl}
        keepMounted
        open={Boolean(anchorEl)}
        onClose={handleClose}
        getContentAnchorEl={null}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        style={{marginTop: "10px"}}
      >
       {messages.map((message) => (
         <MenuItem key={message.timestamp} onClick={handleClose} style={{whiteSpace: 'normal', width: "500px"}}>
            <ListItemIcon>
              {message.priority === 10 ? <AnnouncementIcon fontSize="small" /> : <InfoIcon fontSize="small" />}
            </ListItemIcon>
            <RenderMessage message={message} />
         </MenuItem>
       ))}
      </Menu>
    </>
  );
}