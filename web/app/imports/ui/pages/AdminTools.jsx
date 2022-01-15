import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useDispatch } from 'react-redux';
import Container from '@material-ui/core/Container';
import { Translation } from "../common/Translation.jsx";
import Grid from '@material-ui/core/Grid';
import { Divider, useTheme } from '@material-ui/core';
import InputAdornment from '@material-ui/core/InputAdornment';
import Button from '@material-ui/core/Button';
import Typography from '@material-ui/core/Typography';
import TextField from '@material-ui/core/TextField';
import Tooltip from '@material-ui/core/Tooltip';
import Box from '@material-ui/core/Box';
import { promisify } from '../../api/client/promisify';
import { CONSTANTS } from '../../api/common/constants.js';
import AuthManager from '../../api/common/AuthManager.js';

export const AdminTools = () => {
  const theme = useTheme();
  const dispatch = useDispatch();
  const [txtSearch, setSearch] = React.useState("");
  
  async function searchUsers() {
    const allUsers = await promisify(Meteor.call, CONSTANTS.methods.users.search, { search: txtSearch });
    console.log("allUsers ", allUsers);
  }

  return (
    <Container maxWidth="lg">
      <Grid container alignItems="flex-start" justify="center" spacing={10}>
        <Grid item xs={12}>
          <Typography component="h1" variant="h5" style={{ color: "#fff" }}>
            <Box p={3}>
              Admin Tools
            </Box>
          </Typography>
        </Grid>
        {Meteor.user() && AuthManager.userHasClaim(CONSTANTS.claims.uberMensch._id) &&
          <>
            <Grid item xs={12}>
              <Box mb={2}>
                <Typography variant="h5" color="secondary">
                  Search Users
                </Typography>
              </Box>
              <TextField
                name="txtSearch"
                variant="outlined"
                fullWidth
                id="txtSearch"
                label="search for users"
                value={txtSearch}
                onChange={(e) => { setSearch(e.target.value); }}
                autoFocus
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Button color="secondary" variant="outlined" onClick={searchUsers}>
                        Go
                      </Button>
                    </InputAdornment>
                  ),
                }}
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
            </Grid>
          </>
        }
      </Grid>
    </Container>
  );
};