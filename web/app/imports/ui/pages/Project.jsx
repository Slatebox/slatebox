// /projects/:projectId/:folderId? — one project (a drive) or a folder in it: its slates with the same
// cards, live still pictures, search and paging as My slates, its folders, Share, and the Recipes tab
// where enterprise code runs and recipes are on. /p/:accessKey (a drive's link) lands here with ?p=.
// A phone views a project: it opens slates and changes nothing (projectAbilities with phone).
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import { useAtomValue } from 'jotai'
import DisplaySlates from '../components/DisplaySlates'
import EmptyState from '../components/EmptyState'
import AppPage from '../common/AppPage'
import EnterpriseSlot from '../common/EnterpriseSlot'
import usePhoneView from '../common/usePhoneView'
import projectsApi from '../../api/client/projects'
import { enterpriseSlots } from '../../api/client/enterprise-slots.mjs'
import ProjectHeader from '../components/projects/ProjectHeader'
import ProjectFolders from '../components/projects/ProjectFolders'
import ProjectShareDialog from '../components/projects/ProjectShareDialog'
import MoveSlatesHereDialog from '../components/projects/MoveSlatesHereDialog'
import { newSlatePath, projectAbilities, projectEmptyState, projectErrorWords, projectPath } from '../components/projects/projectsModel.mjs'
import { projectsVersion } from '../jotai/atoms'

export default function Project() {
  const { projectId, folderId = null } = useParams()
  const [params] = useSearchParams()
  const linkKey = params.get('p') || null
  const history = useNavigate()
  const phone = usePhoneView()
  const version = useAtomValue(projectsVersion)
  const [answer, setAnswer] = useState(null)
  const [failed, setFailed] = useState('')
  const [chosenTab, setTab] = useState(params.get('tab') === 'recipes' ? 'recipes' : 'slates')
  // The Recipes tab exists only where enterprise code fills it: anywhere else the page is its slates.
  const recipesHere = useSyncExternalStore(enterpriseSlots.subscribe, () => Boolean(enterpriseSlots.get('project.recipes')))
  const tab = chosenTab === 'recipes' && recipesHere ? 'recipes' : 'slates'
  const [sharing, setSharing] = useState(false)
  const [movingHere, setMovingHere] = useState(false)
  const [listKey, setListKey] = useState(0)

  const load = () => projectsApi.get({ projectId: folderId || projectId, ...(linkKey && { linkKey }) })
  useEffect(() => {
    let live = true
    setFailed('')
    load().then((a) => { if (live) setAnswer(a) }, (e) => { if (live) { setAnswer(null); setFailed(projectErrorWords(e)) } })
    return () => { live = false }
  }, [projectId, folderId, linkKey, version])

  if (failed) {
    return <AppPage><EmptyState variant="lost" title="This project isn’t here" body={failed} action={{ label: 'Open Projects', to: '/projects' }} /></AppPage>
  }
  if (!answer?.drive) return <AppPage><Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Opening the project" /></Box></AppPage>

  const { drive, folders = [] } = answer
  const here = answer.project || drive
  const role = drive.role || here.role || null
  const abilities = projectAbilities(role, { phone })
  const listId = folderId || drive._id
  const refresh = () => setListKey((k) => k + 1)
  const empty = projectEmptyState({ abilities, folder: Boolean(folderId) })
  const header = (
    <ProjectHeader drive={drive} here={here} role={role} abilities={abilities} tab={tab} onTab={setTab} linkKey={linkKey}
      onShare={() => setSharing(true)} onMoveHere={() => setMovingHere(true)} onChanged={refresh} />
  )
  const emptyNode = (
    <EmptyState variant="empty" title={empty.title} body={empty.body}>
      {empty.actions.map((a) => (a.id === 'add'
        ? <Button key={a.id} variant="contained" disableElevation size="large" sx={{ borderRadius: 6, px: 3 }} onClick={() => history(newSlatePath(listId))}>{a.label}</Button>
        : <Button key={a.id} variant="outlined" size="large" sx={{ borderRadius: 6, px: 3 }} onClick={() => setMovingHere(true)}>{a.label}</Button>))}
      {/* Add a recipe: only where enterprise code runs and recipes are on (renders nothing elsewhere). */}
      {empty.recipes && <EnterpriseSlot name="project.addRecipe" projectId={drive._id} role={role} onAdded={() => setTab('recipes')} />}
    </EmptyState>
  )

  return (
    <>
      {tab === 'slates' ? (
        <Box role="tabpanel" id="project-panel-slates" aria-labelledby="project-tab-slates" sx={{ height: '100%' }} data-project-page={drive._id}>
          <DisplaySlates key={`${listId}:${listKey}`} type="project" projectId={listId} linkKey={linkKey} projectRole={role}
            header={(
              <>
                {header}
                <ProjectFolders drive={drive} folders={folders} folderId={folderId} abilities={abilities} slateCount={here.slateCount}
                  onChanged={refresh} onLeaveFolder={(parentId) => history(projectPath(drive._id, parentId))} />
              </>
            )}
            empty={emptyNode} />
        </Box>
      ) : (
        <AppPage data-project-page={drive._id}>
          {header}
          <Box role="tabpanel" id="project-panel-recipes" aria-labelledby="project-tab-recipes">
            <EnterpriseSlot name="project.recipes" projectId={drive._id} project={drive} role={role} />
          </Box>
        </AppPage>
      )}
      {abilities.share && <ProjectShareDialog open={sharing} drive={drive} role={role} onClose={() => setSharing(false)} />}
      {abilities.moveOwnSlates && (
        <MoveSlatesHereDialog open={movingHere} projectId={listId} projectName={here.name} onClose={() => setMovingHere(false)}
          onMoved={() => { setMovingHere(false); refresh() }} />
      )}
    </>
  )
}
