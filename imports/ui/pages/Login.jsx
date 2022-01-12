import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import Avatar from '@material-ui/core/Avatar';
import Button from '@material-ui/core/Button';
import CssBaseline from '@material-ui/core/CssBaseline';
import TextField from '@material-ui/core/TextField';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Checkbox from '@material-ui/core/Checkbox';
import Link from "@material-ui/core/Link";
import { Link as RouterLink } from 'react-router-dom';
import Grid from '@material-ui/core/Grid';
import Box from '@material-ui/core/Box';
import LockOutlinedIcon from '@material-ui/icons/LockOutlined';
import Typography from '@material-ui/core/Typography';
import { makeStyles } from '@material-ui/core/styles';
import { useHistory } from "react-router-dom";
import Container from '@material-ui/core/Container';
import Snackbar from '@material-ui/core/Snackbar';
import Alert from '@material-ui/lab/Alert';
import { useParams } from "react-router";
import { createAnonymousUser } from '../../api/client/createAnonymousUser.js';

import { CONSTANTS } from '../../api/common/constants.js';
import { promisify } from '../../api/client/promisify.js';


const useStyles = makeStyles((theme) => ({
  paper: {
    marginTop: theme.spacing(8),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  avatar: {
    margin: theme.spacing(1),
    backgroundColor: theme.palette.secondary.main,
  },
  form: {
    width: '100%', // Fix IE 11 issue.
    marginTop: theme.spacing(1),
  },
  submit: {
    margin: theme.spacing(3, 0, 2),
  },
  register: {
    margin: theme.spacing(3, 0, 2),
  },
}));

export const Login = (props) => {  
  const classes = useStyles();
  const history = useHistory();
  const { email } = useParams();
  const [warning, setLoginWarning] = useState({ visible: false, err: '' });

  const performLogin = (e) => {
    e.preventDefault();
    let email = document.getElementById("email").value;
    let pwd = document.getElementById("password").value;
    Meteor.loginWithPassword(email, pwd, (err, msg) => {
      if (err) {
        setLoginWarning({ visible: true, err: 'Invalid login, please try again' });
      } else {
        history.push("/"); //dashboard
        setLoginWarning(null);
      }
    });
  };

  const closeLoginWarning = (e) => {
    setLoginWarning({ visible: false, err: '' });
  };

  return (
    <Container component="main" maxWidth="xs">
      <div className={classes.paper}>
        <Avatar className={classes.avatar}>
          <LockOutlinedIcon />
        </Avatar>
        <Typography component="h1" variant="h5" style={{color:"#fff"}}>
          Sign in
        </Typography>
        <form onSubmit={performLogin} className={classes.form} noValidate>
          <TextField
            variant="outlined"
            margin="normal"
            required
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            value={email}
            autoFocus={email === null}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
          />
          <TextField
            variant="outlined"
            margin="normal"
            required
            fullWidth
            name="password"
            label="Password"
            type="password"
            id="password"
            autoComplete="current-password"
            autoFocus={email !== null}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
          />
          <Button
            type="submit"
            fullWidth
            variant="contained"
            color="primary"
            className={classes.submit}
          >
            Sign In
          </Button>
          <Grid container>
            <Grid item xs>
              <Link component={RouterLink} to="/recover" variant="body2" style={{color:"#fff"}}>
                Forgot password?
              </Link>
            </Grid>
          </Grid>
        </form>
        <Typography component="h1" variant="h5" style={{color:"#fff"}}>
          - OR -
        </Typography>
        <Button
          type="button"
          fullWidth
          variant="contained"
          color="secondary"
          onClick={async (e) => {
            try {
              await createAnonymousUser();
              history.push("/");
            } catch (err) {
              setLoginWarning({ visible: true, err: 'There was a problem creating your account, please try again.' });
            }
          }}
          className={classes.register}
        >
          Start now. No regististration required.
        </Button>
      </div>
      <Snackbar anchorOrigin={{vertical: 'top', horizontal: 'center'}} open={warning?.visible} onClose={closeLoginWarning} autoHideDuration={6000}>
        <Alert severity="error">
          {warning.err}
        </Alert>
      </Snackbar>
    </Container>
  );
}