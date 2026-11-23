export default function parseTemplateIntoCategories(slate) {
  const nodes = slate.nodes.allNodes ?? slate.nodes
  const categories = nodes
    .filter((n) => n.options.isCategory && n.options.categoryName?.length)
    .map((nx) => ({
      xPos: nx.options.xPos,
      yPos: nx.options.yPos,
      width: nx.options.width,
      height: nx.options.height,
      categoryName: nx.options.categoryName,
      color: nx.options.backgroundColor,
    }))

  // console.log(
  //   'rectnagles, categories',
  //   slate?.nodes?.allNodes?.length,
  //   rectangles,
  //   categories
  // )

  const matched = {}

  categories.forEach((categ) => {
    if (!matched[categ.categoryName]) {
      matched[categ.categoryName] = {
        top: categ.yPos,
        left: categ.xPos,
        bottom: categ.yPos + categ.height,
        right: categ.xPos + categ.width,
        color: categ.color,
      }
    }
  })

  return matched
}
