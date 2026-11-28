// /p/:accessKey — a project's link. Someone without an account becomes a guest first (as copying a
// slate does), then the drive opens with the key, and the link's role applies to every slate in it.
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Navigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import AppPage from '../common/AppPage'
import EmptyState from '../components/EmptyState'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import projectsApi from '../../api/client/projects'
import { projectErrorWords, projectPath } from '../components/projects/projectsModel.mjs'

export default function ProjectLink() {
  const { accessKey } = useParams()
  const [to, setTo] = useState(null)
  const [failed, setFailed] = useState('')
  useEffect(() => {
    let live = true
    async function open() {
      try {
        if (!Meteor.userId()) await createAnonymousUser()
        const answer = await projectsApi.get({ accessKey })
        if (live) setTo(`${projectPath(answer.drive._id)}?p=${encodeURIComponent(accessKey)}`)
      } catch (e) {
        if (live) setFailed(projectErrorWords(e))
      }
    }
    open()
    return () => { live = false }
  }, [accessKey])
  if (to) return <Navigate replace to={to} />
  if (failed) return <AppPage><EmptyState variant="lost" title="This link doesn’t open a project" body={`${failed} Ask whoever shared it for a new link.`} action={{ label: 'Open My slates', to: '/' }} /></AppPage>
  return <AppPage><Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Opening the project" /></Box></AppPage>
}
