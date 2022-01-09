import { Meteor } from 'meteor/meteor';
import { Picker } from 'meteor/communitypackages:picker';
import { CachedImages } from '../imports/api/common/models';
import { Buffer } from 'buffer';
import { Readable } from 'stream';

const gets = Picker.filter(Meteor.bindEnvironment((req, res) => {
  return req.method === "GET"
}));

gets.route('/sbimages/:url', function(params, req, res, next) {
  console.log("url is ", params.url);
  let finalize = Meteor.bindEnvironment(async () => {
    const q = {
      url: params.url
    };
    const image = CachedImages.findOne(q);
    console.log("got image ", image);
    if (image) {
      // res.setEncoding('binary'); - not a function
      let mime = "image/jpeg";
      if (image.url.endsWith(".gif")) {
        mime = "image/gif";
      } else if (image.url.endsWith(".png")) {
        mime = "image/png";
      }
      const imgBuf = Buffer.from(image.bytes, "binary"); //.toString("base64"); //, "binary");
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': imgBuf.length
      });
      Readable.from(Buffer.from(image.bytes, "binary")).pipe(res);
      // res.end(imgBuf, "binary"); //, 'binary'));
    } else {
      res.end();
    }
  });
  finalize();
});