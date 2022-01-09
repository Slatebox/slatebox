"use strict";

const { go, resize, evaluate, click, type, sendCharacter, waitForText, test, l, Locator } = require('testim');



Locator.set(require('./locators/locators.js'));

test("Test Node Text", async () => {
  await go("http://localhost:3000");
  await resize({width: 1024, height: 680});
  async function Anonymous_Log_In() {
    await evaluate(() => {
      Meteor.logout();
      window.location.href = "/";
    });
    await click(l("jhwEpTxRHMpDkC7S"));
    await evaluate(() => {
      Meteor.user() !== null;
    });
  }
  await Anonymous_Log_In();
  await click(l("Q5Iuiz48JtFwL35d"));
  await click(l("[dy='6.25']"));
  // Converting a 'drag' step has to be done manually at this time
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("TEXT"));
  await click(l("[id='txtNode']"));
  await type(l("[id='txtNode']"), 'HELLO WORLD');
  await sendCharacter(l("[id='txtNode']"), '');
  await waitForText(l("[dy='4.25']"), 'HELLO WORLD');
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await resize({width: 1157, height: 680});
  await click(l("18"));
  await click(l("40"));
  await sendCharacter(l("[id='font-size']"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  // Converting a 'drag' step has to be done manually at this time
  await click(l("[dy='4.25']"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("Indie_Flower"));
  await click(l("Bangers"));
  await sendCharacter(l("Bangers"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[dy='13']"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("[class^='makeStyles-items'],_[class"));
  await sendCharacter(l("COLOR_TEXT_SHAPE_IMAGE_EFFECTS__40_"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[dy='13']"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("DROPSHADOW"));
  await sendCharacter(l("[aria-pressed='true']"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[dy='13']"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("TATTERED"));
  await sendCharacter(l("[aria-pressed='true']"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[class^='slateboxInternal'],_[class"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("BLUR"));
  await sendCharacter(l("[aria-pressed='true']"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[class^='slateboxInternal'],_[class"));
  await click(l("[dy='13']"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("OUTLINE"));
  await sendCharacter(l("[aria-pressed='true']"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[dy='13']"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("[class^='makeStyles-items'],_[class"));
  await sendCharacter(l("COLOR_TEXT_SHAPE_IMAGE_EFFECTS__40_"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[class^='slateboxInternal'],_[class"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("[d='M7_15v2h10v-2H7zm-4_6h18v-2H3v2"));
  await sendCharacter(l("COLOR_TEXT_SHAPE_IMAGE_EFFECTS__40_"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[class^='slateboxInternal'],_[class"));
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  await click(l("[d='M3_21h18v-2H3v2zm6-4h12v-2H9v2z"));
  await sendCharacter(l("COLOR_TEXT_SHAPE_IMAGE_EFFECTS__40_"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await click(l("[d='M16.015,12.03c-2.156,0-3.903,1."));
  // Converting a 'drag' step has to be done manually at this time
  await sendCharacter(l("[id='txtNode']"), '');
  // Converting a 'html-attr-validation' step has to be done manually at this time
  await evaluate(() => {
    Meteor.logout();
    window.location.href = "/";
  });

}); // end of test
