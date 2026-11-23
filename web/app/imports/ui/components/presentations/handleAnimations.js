const handleAnimations = (nodeIds, isEntering, isLowPerformance = false) => {
  if (isLowPerformance) {
    // Simplified animations for low-performance devices
    nodeIds.forEach((nodeId) => {
      const elements = document.querySelectorAll(`[rel="${nodeId}"]`)
      const textElements = document.querySelectorAll(`[rel="text-${nodeId}"]`)
      ;[...elements, ...textElements].forEach((element) => {
        element.style.opacity = 1
      })
    })
    return
  }
  nodeIds.forEach((nodeId) => {
    const animatedVects = document.querySelectorAll(
      `[rel="${nodeId}"][data-defer-animation]`
    )

    // Select only text elements WITHOUT the data-defer-animation attribute
    const nonAnimatedTextElements = document.querySelectorAll(
      `[rel="text-${nodeId}"]:not([data-defer-animation])`
    )

    // Select only the text elements with animation attribute for animation processing
    const animatedTexts = document.querySelectorAll(
      `[rel="text-${nodeId}"][data-defer-animation]`
    )

    // Set opacity for non-animated text elements related to this node
    nonAnimatedTextElements.forEach((element) => {
      element.style.opacity = 1
    })

    // console.log('checking animation scene', animatedVects.length, animatedTexts.length);
    // only animate if all elements have animations
    // if (
    //   animatedVects.length === nodeIds.length ||
    //   animatedTexts.length === nodeIds.length
    // ) {
    ;[...animatedVects, ...animatedTexts].forEach((element) => {
      element.style.opacity = 1
      const animationClass = element.getAttribute('data-defer-animation')
      if (animationClass && isEntering) {
        // Add animation class when entering view
        element.style.animation = ''
        requestAnimationFrame(() => {
          element.classList.add(animationClass)
        })
      } else if (animationClass) {
        // Remove animation class when leaving view
        element.classList.remove(animationClass)
      }
    })
    // }
  })
}

export default handleAnimations
