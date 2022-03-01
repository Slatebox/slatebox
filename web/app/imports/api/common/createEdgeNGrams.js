/* eslint-disable no-param-reassign */
// gratituous theft: https://stackoverflow.com/questions/44833817/mongodb-full-and-partial-text-search
function createEdgeNGrams(str) {
  if (str && str.length > 3) {
    const minGram = 3
    const maxGram = str.length
    return str
      .split(' ')
      .reduce((ngrams, token) => {
        if (token.length > minGram) {
          for (let i = minGram; i <= maxGram && i <= token.length; ++i) {
            ngrams = [...ngrams, token.substr(0, i)]
          }
        } else {
          ngrams = [...ngrams, token]
        }
        return ngrams
      }, [])
      .join(' ')
  }
  return str
}

export default createEdgeNGrams
