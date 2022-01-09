"use strict";

const { go, resize, evaluate, click, test, l, Locator } = require('testim');



Locator.set(require('./locators/locators.js'));

test("Test Node Colors", async () => {
  await go("http://localhost:3000");
  await resize({width: 1024, height: 680});
  async function Anonymous_Log_In() {
    await evaluate(() => {
      Meteor.logout();
      window.location.href = "/";
    });
    await click(l("START_NOW._NO_REGISTISTRATION_REQUI"));
    await evaluate(() => {
      Meteor.user() !== null;
    });
  }
  await Anonymous_Log_In();
  await click(l("NEW_SLATE"));
  // Converting a 'drag' step has to be done manually at this time
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await evaluate(() => {
    exports.presetColors = ["#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#2196f3", "#03a9f4", "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39", "#ffeb3b", "#ffc107", "#ff9800", "#ff5722", "#795548", "#607d8b"];
  });
  await evaluate(() => {
    exports.currentTestIndex = 0;
  });
  await evaluate(() => {
    exports.testParam = "fill";
  });
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("BORDER"));
  // Converting a 'drag' step has to be done manually at this time
  await evaluate(() => {
    exports.currentTestIndex = 0;
  });
  await evaluate(() => {
    exports.testParam = "stroke"
  });
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await click(l("[class^='MuiGrid-spacing-xs'],_[cla"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  // Converting a 'drag' step has to be done manually at this time
  // Converting a 'drag' step has to be done manually at this time
  // Converting a 'drag' step has to be done manually at this time
  // Converting a 'drag' step has to be done manually at this time
  await click(l("[aria-label='border_options']_.MuiS"));
  await click(l("[stroke-dasharray='3,1']"));
  await click(l("BORDER:_DASHED"));
  await click(l(".MuiButton-containedPrimary"));
  await click(l("[aria-describedby='mui-48177']"));
  await click(l(".MuiButton-containedPrimary"));
  await click(l("[aria-describedby='mui-48177']"));
  await click(l(".MuiButton-containedPrimary"));
  await click(l("[aria-describedby='mui-48177']"));
  await evaluate((param) => {
    document.querySelector("#slateCanvas > div > svg > path:nth-child(2)").getAttribute(testParam) === presetColors[currentTestIndex];
    exports.currentTestIndex++;
  }, );
  await evaluate(() => {
    Meteor.logout();
    window.location.href = "/";
  });

}); // end of test
