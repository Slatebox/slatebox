// What a slate list says when it has nothing to show (components/DisplaySlates.jsx): a title, a
// line on why, and the one thing to do next. A filter that matched nothing offers to clear it.
export function emptySlatesCopy({ type, signedIn, filter = '', privateOnly = false }) {
  const words = (filter || '').trim()
  if (words) {
    const what = { community: 'public slates', team: 'team slates' }[type] || 'slates'
    return { title: `No ${what} match “${words}”`, body: 'Try another word, or clear the filter.', clear: true }
  }
  const start = { label: 'Start a slate', to: '/new' }
  if (type === 'community') {
    if (!signedIn) {
      return {
        title: 'See what people share',
        body: 'Sign in to explore public slates, or start one of your own. No account needed.',
        action: start,
        secondary: { label: 'Sign in', to: '/login' },
      }
    }
    return {
      title: 'Nothing shared publicly yet',
      body: 'Make one of your slates public from Share and it shows up here for everyone.',
      action: start,
    }
  }
  if (type === 'team') {
    return { title: 'No team slates yet', body: 'Slates your teammates make, and the ones you share with the team, show up here.', action: start }
  }
  if (type === 'templates') return { title: 'No templates yet', body: 'Ask Slatebox has boards and diagrams to start from.', action: start }
  if (privateOnly) return { title: 'No private slates', body: 'Every slate you have is shared. Turn off Private to see them all.' }
  return {
    title: 'No slates yet',
    body: 'Start with a blank slate, a board or a diagram. Ask Slatebox can draw the first one with you.',
    action: start,
  }
}

// Which of the list's states to paint. `answer` is the last reply from slates.get: null before the
// first one comes back, { ok: false } when the fetch failed, { ok: true, total } otherwise. The
// empty state shows only once a reply said there are none, so it never flashes before the first fetch
// and never tells someone with slates that they have none because a fetch failed.
export function slateListView({ signedIn, loading, answer }) {
  if (!signedIn) return 'empty'
  if (loading || !answer) return 'loading'
  if (!answer.ok) return 'error'
  return answer.total === 0 ? 'empty' : 'list'
}

export const SLATES_FAILED_COPY = { line: 'We couldn’t load your slates just now.', retry: 'Try again' }

export default emptySlatesCopy
