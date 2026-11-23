import PropTypes from 'prop-types'

const nodeProps = PropTypes.shape({
  relationships: PropTypes.shape({
    associations: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string,
      })
    ),
  }),
  options: PropTypes.shape({
    lineColor: PropTypes.string,
    lineWidth: PropTypes.number,
    lineOpacity: PropTypes.number,
    lineEffect: PropTypes.string,
    parentArrowForChildren: PropTypes.bool,
    noChildArrowForChildren: PropTypes.bool,
  }),
})

export default nodeProps
