export default function closestPoint(pathNode, point) {
  var pathLength = pathNode.getTotalLength(),
    precision = 64, //increase this value for better performance at a risk of worse point approximation; in future this should be scaled according to number of path segments (there could be a better solution)
    best,
    bestLength,
    bestDistance = Infinity;
  // linear scan for coarse approximation
  for (var scan, scanLength = 0, scanDistance; scanLength <= pathLength; scanLength += precision) {
    if ((scanDistance = distance2(scan = pathNode.getPointAtLength(scanLength))) < bestDistance) {
      best = scan, bestLength = scanLength, bestDistance = scanDistance;
    }
  }

  // binary search for precise estimate
  precision /= 2;
  while (precision > 0.5) {
    var before,
      after,
      beforeLength,
      afterLength,
      beforeDistance,
      afterDistance;
    if ((beforeLength = bestLength - precision) >= 0 && (beforeDistance = distance2(before = pathNode.getPointAtLength(beforeLength))) < bestDistance) {
      best = before, bestLength = beforeLength, bestDistance = beforeDistance;
    } else if ((afterLength = bestLength + precision) <= pathLength && (afterDistance = distance2(after = pathNode.getPointAtLength(afterLength))) < bestDistance) {
      best = after, bestLength = afterLength, bestDistance = afterDistance;
    } else {
      precision /= 2;
    }
  }
  return {bestPoint: best, bestLength};

  function distance2(p) { //squared distance between two points
    var dx = p.x - point.x,
      dy = p.y - point.y;
    return dx * dx + dy * dy;
  }
}