// Every drive and folder the signed-in person sees (projects.list), asked again whenever a project is
// made, renamed, shared or deleted (projectsVersion). null until the first answer; [] for a guest.
import { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtomValue, useSetAtom } from 'jotai'
import projectsApi from '../../../api/client/projects'
import { projectsVersion } from '../../jotai/atoms'

export function useProjectsChanged() {
  const bump = useSetAtom(projectsVersion)
  return () => bump((n) => n + 1)
}

export default function useProjects() {
  const { userId, guest } = useTracker(() => ({ userId: Meteor.userId(), guest: Boolean(Meteor.user()?.isAnonymous) }), [])
  const version = useAtomValue(projectsVersion)
  const [projects, setProjects] = useState(null)
  useEffect(() => {
    if (!userId || guest) { setProjects([]); return undefined }
    let live = true
    projectsApi.list({}).then(
      (answer) => { if (live) setProjects(Array.isArray(answer?.projects) ? answer.projects : []) },
      () => { if (live) setProjects((had) => had ?? []) },
    )
    return () => { live = false }
  }, [userId, guest, version])
  return projects
}
