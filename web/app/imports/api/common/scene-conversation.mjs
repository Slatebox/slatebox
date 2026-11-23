const prints = ['firstPrint','secondPrint','thirdPrint']
export function sceneObjects(model, config) {
  if (model.kind === 'moon-gallery') return model.panels.map(panel => ({id:panel.id,label:panel.label,caption:panel.label}))
  if (model.kind === 'focus-darkroom') return prints.map((id,index) => ({id,label:model[id],caption:['First print','Second print','Third print'][index]}))
  return config.labels.map(({field,caption}) => ({id:field,label:model[field],caption}))
}

function findObject(objects, name, selected) {
  if (/^(it|this print)$/i.test(name) && selected) {
    const item = objects.find(o => o.id === selected)
    if (item) return item
  }
  const query = name.trim().toLowerCase()
  const found = objects.filter(o => [o.caption,o.id,o.label].some(text => text.toLowerCase() === query))
  if (found.length !== 1) throw new Error('Name one item from the current scene.')
  return found[0]
}

export function proposeSceneChange(model, config, message, selected) {
  const words = message.trim(), objects = sceneObjects(model, config)
  const rename = /^(?:rename|set|change) (.+?) to (.+)$/i.exec(words)
  const after = /^hang (.+?) after (.+)$/i.exec(words)
  const anytime = /^let (.+?) hang any time$/i.exec(words)
  let next, reply
  if (rename) {
    const object = findObject(objects,rename[1],selected)
    const label = rename[2].trim()
    next = model.kind === 'moon-gallery' ? {...model,panels:model.panels.map(p=>p.id===object.id?{...p,label}:p)} : {...model,[object.id]:label}
    reply = object.caption + ' will read “' + label + '”.'
  } else if (model.kind === 'moon-gallery' && (after || anytime)) {
    const object = findObject(objects,(after || anytime)[1],selected)
    const before = after ? findObject(objects,after[2]) : null
    next = {...model,panels:model.panels.map(p=>p.id===object.id?{...p,after:before?.id ?? null}:p)}
    reply = before ? 'Hang ' + object.label + ' after ' + before.label + '.' : object.label + ' can hang any time.'
  } else {
    throw new Error(model.kind === 'moon-gallery' ? 'Use “Rename” with a panel name, or “Hang” with two panel names separated by “after”.' : 'Use “Set” with an item name, then “to” and the words you want on the slate.')
  }
  const normalized = config.normalize(next)
  if (!normalized) throw new Error(model.kind === 'moon-gallery' ? 'Use a short name and a hanging order the current wall can follow.' : 'Use a shorter label for this scene.')
  return {model:normalized,reply}
}
