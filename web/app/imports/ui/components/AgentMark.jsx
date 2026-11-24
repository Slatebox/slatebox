// An agent's mark (no engine code, so any page may draw it).
import React from 'react'
import PropTypes from 'prop-types'

// An agent's mark: the hexagon in its colour with the spark, on its chip and beside what it says in Ask Slatebox.
export default function Hexagon({ color, size = 18, style = { marginLeft: 6 } }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <polygon points="21.5,12 16.75,20.23 7.25,20.23 2.5,12 7.25,3.77 16.75,3.77" fill={color} stroke="#fff" strokeWidth="1.5" />
      <path d="M18 2 L19 4.5 L21.5 5.5 L19 6.5 L18 9 L17 6.5 L14.5 5.5 L17 4.5 Z" fill="#fde68a" />
    </svg>
  )
}
Hexagon.propTypes = { color: PropTypes.string.isRequired, size: PropTypes.number, style: PropTypes.object }
