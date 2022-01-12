import assert from "assert";
import { chromium } from "playwright";

describe('should work', async function () {
  let browser, page;
  before(async function () {
    console.log('launching browser');
    browser = await chromium.launch(); //{ headless: false }
  });
  after(async function() {
    await browser.close();
  })
  beforeEach(async function() {
    page = await browser.newPage();
  })
  afterEach(async function () {
    await page.close();
  });
  it('loads page correct', async function() {
    this.timeout(0);
    const navigationPromise = page.waitForNavigation();
    // await page.goto('https://slatebox.com/');
    // await page.setViewportSize({ width: 1536, height: 881 });

    // //assert.equal(await page.title(), 'Slatebox');

    // await page.waitForNavigation();

    await page.goto('https://slatebox.com/');
    await page.setViewportSize({ width: 1536, height: 528 });
    
    await navigationPromise
    
    await page.waitForSelector('.container > #navigation > .nav > li:nth-child(6) > .headerNav')
    await page.click('.container > #navigation > .nav > li:nth-child(6) > .headerNav')
    
    await page.waitForSelector('#gallery-items > .col-lg-3 > #slate_38ce7a87 > .slateboxInternal > svg')
    await page.click('#gallery-items > .col-lg-3 > #slate_38ce7a87 > .slateboxInternal > svg')

    assert.equal(await page.title(), 'Slatebox');

    // await page.waitForSelector('.container > #navigation > .nav > li:nth-child(6) > .headerNav')
    // await page.click('.container > #navigation > .nav > li:nth-child(6) > .headerNav')
    
    // await page.waitForSelector('body > #gallery > .container > #gallery-items > .slateOpenMore')
    // await page.click('body > #gallery > .container > #gallery-items > .slateOpenMore')
    
    // await page.waitForSelector('.container-fluid > .row > .col-md-offset-1 > .row > .slateOpenMore')
    // await page.click('.container-fluid > .row > .col-md-offset-1 > .row > .slateOpenMore')
    
    // await page.waitForSelector('.container-fluid > .row > .col-md-offset-1 > .row > .slateOpenMore')
    // await page.click('.container-fluid > .row > .col-md-offset-1 > .row > .slateOpenMore')
    
    // await page.waitForSelector('.row > .col-md-3 > #slate_763dd634 > .slateboxInternal > svg')
    // await page.click('.row > .col-md-3 > #slate_763dd634 > .slateboxInternal > svg')
    
    // await page.waitForSelector('.container-fluid > .col-md-offset-1 > #publicSlate > .slateboxInternal > svg')
    // await page.click('.container-fluid > .col-md-offset-1 > #publicSlate > .slateboxInternal > svg')

    // const userName = await page.$eval('#getUserName', el => el.textContent.trim());
    // console.log("got username", userName);
    // assert.equal(userName, 'by Hana Pecůchová');

  });
});

// describe("simple-todos-react", function () {
//   it("package.json has correct name", async function () {
//     const { name } = await import("../package.json");
//     assert.strictEqual(name, "simple-todos-react");
//   });

//   if (Meteor.isClient) {
//     it("client is not server", function () {
//       assert.strictEqual(Meteor.isServer, false);
//     });
//   }

//   if (Meteor.isServer) {
//     it("server is not client", function () {
//       assert.strictEqual(Meteor.isClient, false);
//     });
//   }
// });
