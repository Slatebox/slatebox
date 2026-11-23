// Add a function to detect device performance

/**
 * Detects if the current device has low performance characteristics
 * @returns {boolean} True if the device is detected as low performance
 */
export default function detectDevicePerf() {
  // Check if we're running in a browser environment
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  let lowPerformance = false

  // Check specifically for mobile devices
  const isMobileDevice =
    /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ipad|iphone|ipod|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series40|symbian|treo|up\.browser|up\.link|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(
      navigator.userAgent
    )

  const isTouchDevice = 'ontouchend' in document

  // Immediately set lowPerformance to true if it's a mobile device
  if (isMobileDevice || isTouchDevice) {
    lowPerformance = true
    // Skip further checks for mobile devices
    return lowPerformance
  }

  // Continue with other checks for non-mobile devices
  const isLowEndDevice =
    // Check for older browsers
    !window.requestAnimationFrame || !window.performance

  if (isLowEndDevice) {
    lowPerformance = true
  }

  // Run a more sophisticated performance test
  const startTime = performance.now()

  // Create a test div for DOM manipulation performance
  const testDiv = document.createElement('div')
  testDiv.style.position = 'absolute'
  testDiv.style.left = '-9999px'
  testDiv.style.top = '-9999px'
  document.body.appendChild(testDiv)

  // Measure how many DOM operations we can do in a short time
  const endTime = startTime + 50 // 50ms test
  const operations = []
  while (performance.now() < endTime && operations.length < 5000) {
    testDiv.style.opacity = operations.length % 2 ? '0.5' : '0.51'
    operations.push(1)
  }

  // Clean up
  document.body.removeChild(testDiv)

  // If we couldn't do many operations, consider it a low-performance device
  // Threshold can be adjusted based on testing
  const deviceIsLowPerformance = operations.length < 1000
  lowPerformance = deviceIsLowPerformance

  // Also check for hardware concurrency if available
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) {
    lowPerformance = true
  }

  // Check for memory constraints if available
  if (navigator.deviceMemory && navigator.deviceMemory < 4) {
    lowPerformance = true
  }

  // console.log(
  //   `Performance detection: ${
  //     deviceIsLowPerformance ? 'Low' : 'High'
  //   } performance device detected (${operations.length} operations in 50ms)`
  // )

  return lowPerformance
}
