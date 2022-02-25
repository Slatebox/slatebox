export default function getDepCoords(p, options) {
  var lx = p.x - 5
    , tx = p.x + (options.width / 2)
    , ty = p.y + (options.height / 2);

  if (options.vectorPath === "ellipse") {
    lx = p.cx - 5;
    tx = p.cx;
    ty = p.cy;
  }

  return { lx: lx, tx: tx, ty: ty };
};