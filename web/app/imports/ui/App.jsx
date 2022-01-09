import React from "react";
import {
  BrowserRouter as Router
} from "react-router-dom";
import { Main } from "./Main";

export const App = () => {
  return (
    <Router>
      <Main />
    </Router>
  );
};