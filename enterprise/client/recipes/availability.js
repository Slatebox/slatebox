// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Whether recipes show here (recipesModel.mjs recipesAvailability): asked once per page life with
// recipes.catalog and shared by the Recipes tab, "Add a recipe" and the panel. A server admin on an
// install where recipes are off sees the one switch; everyone else sees no recipe controls.
import { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import useServerAdmin from '/imports/ui/common/useServerAdmin'
import recipesApi from './recipesApi'
import { recipesAvailability } from './recipesModel.mjs'

let asked = null
const listeners = new Set()

export function refreshCatalog() {
  asked = recipesApi.catalog().then((answer) => ({ answer }), (error) => ({ error }))
  asked.then(() => listeners.forEach((l) => l()))
  return asked
}

export function useCatalog() {
  const admin = useServerAdmin()
  const [got, setGot] = useState(null)
  useEffect(() => {
    let live = true
    const read = () => (asked || refreshCatalog()).then((g) => { if (live) setGot(g) })
    if (Meteor.userId()) read()
    listeners.add(read)
    return () => { live = false; listeners.delete(read) }
  }, [])
  if (!got || admin === null) return { state: 'loading', recipes: [], admin }
  return { state: recipesAvailability({ ...got, admin }), recipes: got.answer?.recipes || [], admin }
}
