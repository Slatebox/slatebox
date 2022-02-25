export default function getCorrectMidPoints(opts = {}) {
  var originBB = opts.parent ? opts.parent.vect.getBBox() : options.parent.vect.getBBox()
    , endBB = opts.child ? opts.child.vect.getBBox() : options.child.vect.getBBox();

  var _px = _in(originBB.x) && originBB.x
    , _pcx = _in(originBB.cx) && originBB.cx
    , _py = _in(originBB.y) && originBB.y
    , _pcy = _in(originBB.cy) && originBB.cy
    , _cx = _in(endBB.x) && endBB.x
    , _ccx = _in(endBB.cx) && endBB.cx
    , _cy = _in(endBB.y) && endBB.y
    , _ccy = _in(endBB.cy) && endBB.cy;

  var relevantParentMiddlePoint;

  const _px1 = originBB.x,
    _py1 = originBB.y,
    _px2 = originBB.x2,
    _py2 = originBB.y,
    _px3 = originBB.x2,
    _py3 = originBB.y2,
    _px4 = originBB.x,
    _py4 = originBB.y2;

  /*
    generic line equation
    y = ((y2-y1)/(x2-x1)) * (x-x1) + y1

    line 1: line passing through upper left corner and bottom right corner
    y = ((_py3 - _py1)/(_px3 - _px1)) * (x - _px1) + _py1

    line 2: line passing through bottom left corner and upper right corner
    y = ((_py2 - _py4)/(_px2 - _px4)) * (x - _px4) + _py4
   */


  //NOTE: comments below apply to a Cartesian coordinate system; the svg coordinate system is slightly different with (0,0) in upper left corner of the plane
  //it means that regular above means below here
  if (_ccy >= ((_py3 - _py1)/(_px3 - _px1)) * (_ccx - _px1) + _py1) {
    //means that child center point is above line 1
    if (_ccy >= ((_py2 - _py4)/(_px2 - _px4)) * (_ccx - _px4) + _py4) {
      //means that child center point is above line 2
      relevantParentMiddlePoint = {x: _pcx, y: _py3};
    } else {
      //means that child center point is either below line 2 or is on line 2
      relevantParentMiddlePoint = {x: _px1, y: _pcy};
    }
  } else {
    //means that child center point is below line 1
    if (_ccy >= ((_py2 - _py4)/(_px2 - _px4)) * (_ccx - _px4) + _py4) {
      //means that child center point is above line 2
      relevantParentMiddlePoint = {x: _px2, y: _pcy};
    } else {
      //means that child center point is either below line 2 or is on line 2
      relevantParentMiddlePoint = {x: _pcx, y: _py1};
    }
  }


  var relevantChildMiddlePoint;

  const _cx1 = endBB.x,
    _cy1 = endBB.y,
    _cx2 = endBB.x2,
    _cy2 = endBB.y,
    _cx3 = endBB.x2,
    _cy3 = endBB.y2,
    _cx4 = endBB.x,
    _cy4 = endBB.y2;

  /*
   generic line equation
   y = ((y2-y1)/(x2-x1)) * (x-x1) + y1

   line 1: line passing through upper left corner and bottom right corner
   y = ((_cy3 - _cy1)/(_cx3 - _cx1)) * (x - _cx1) + _cy1

   line 2: line passing through bottom left corner and upper right corner
   y = ((_cy2 - _cy4)/(_cx2 - _cx4)) * (x - _cx4) + _cy4
   */


  //NOTE: comments below apply to a Cartesian coordinate system; the svg coordinate system is slightly different with (0,0) in upper left corner of the plane
  //it means that regular above means below here
  if (_pcy >= ((_cy3 - _cy1)/(_cx3 - _cx1)) * (_pcx - _cx1) + _cy1) {
    //means that child center point is above line 1
    if (_pcy >= ((_cy2 - _cy4)/(_cx2 - _cx4)) * (_pcx - _cx4) + _cy4) {
      //means that child center point is above line 2
      relevantChildMiddlePoint = {x: _ccx, y: _cy3};
    } else {
      //means that child center point is either below line 2 or is on line 2
      relevantChildMiddlePoint = {x: _cx1, y: _ccy};
    }
  } else {
    //means that child center point is below line 1
    if (_pcy >= ((_cy2 - _cy4)/(_cx2 - _cx4)) * (_pcx - _cx4) + _cy4) {
      //means that child center point is above line 2
      relevantChildMiddlePoint = {x: _cx2, y: _ccy};
    } else {
      //means that child center point is either below line 2 or is on line 2
      relevantChildMiddlePoint = {x: _ccx, y: _cy1};
    }
  }

  return {
    child: relevantChildMiddlePoint,
    parent: relevantParentMiddlePoint
  };
};

function _in(val) {
  return !isNaN(parseFloat(val)) && isFinite(val);
}