import PropTypes from 'prop-types'

const slateProps = PropTypes.shape({
  options: PropTypes.shape({
    viewPort: PropTypes.shape({
      zoom: PropTypes.shape({
        r: PropTypes.number,
      }),
    }),
  }),
  getOrientation: PropTypes.func,
  snapshot: PropTypes.func,
  collab: PropTypes.shape({
    invoke: PropTypes.func,
    send: PropTypes.func,
  }),
})

export default slateProps
