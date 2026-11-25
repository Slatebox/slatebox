import React from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import AppPage from '../common/AppPage'
import ReviewPanel from '../components/library/review/ReviewPanel'

// A suggested integration in review (administrators only: /admin/library/review/:itemId). It has no
// canvas: the review panel stands alone, with what Slatebox found reaching the server, its words to
// refine, the thread with its author and the decision. Approving makes it a Community card in
// Connect an integration › Existing.
export default function LibraryIntegrationReview() {
  const { itemId } = useParams()
  return (
    <AppPage title="Review an integration"
      eyebrow={<Button component={RouterLink} to="/admin/library" size="small" sx={{ px: 0, minWidth: 0 }} data-admin-back="">Library review</Button>}
      subtitle="Someone connected this MCP server and suggested it for everyone. Nothing is listed until you approve it.">
      <Box sx={{ maxWidth: 720 }} data-testid="integration-review">
        <ReviewPanel itemId={itemId} standalone />
      </Box>
    </AppPage>
  )
}
