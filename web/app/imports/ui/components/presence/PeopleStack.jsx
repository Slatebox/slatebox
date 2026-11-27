// The people on the slate in the corner's pill: up to four overlapping avatars, you first, then "+N".
import React from 'react'
import PropTypes from 'prop-types'
import { MoreMark, PersonMark, Stack } from './marks'

export default function PeopleStack({ people, colors }) {
  return (
    <Stack>
      {people.shown.map((person, index) => <PersonMark key={person.key} person={person} colors={colors} z={10 - index} />)}
      {people.more > 0 && <MoreMark count={people.more} colors={colors} />}
    </Stack>
  )
}
PeopleStack.propTypes = {
  people: PropTypes.shape({ shown: PropTypes.arrayOf(PropTypes.object).isRequired, more: PropTypes.number.isRequired }).isRequired,
  colors: PropTypes.objectOf(PropTypes.string).isRequired,
}
