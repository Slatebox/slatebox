import { PropTypes } from 'prop-types'

const associationProps = PropTypes.shape({
  id: PropTypes.string,
  child: PropTypes.shape({
    options: PropTypes.shape({
      id: PropTypes.string,
    }),
  }),
})

export default associationProps
