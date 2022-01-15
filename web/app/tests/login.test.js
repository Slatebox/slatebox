"use strict";

const { go, resize, click, type, test, l, Locator } = require('testim');



Locator.set(require('./locators/locators.js'));

test("Login", async () => {
  await go("http://localhost:3000");
  await resize({width: 1024, height: 680});
  await click(l("START_NOW._NO_REGISTISTRATION_REQUI"));
  await click(l("My_Slates_Search..._NEW_SLATE_No_sl"));
  await type(l("Forever_Free_Team_0_My_Slates_Creat"), '');
  await resize({width: 1024, height: 442});

}); // end of test
