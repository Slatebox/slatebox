import React, {useRef, useState} from 'react'
import {Box, Button, TextField, Typography} from '@mui/material'
import {proposeSceneChange, sceneObjects} from '../../api/common/scene-conversation.mjs'

export default function SceneConversation({model, config, revision, saving, preview, setPreview, selected, onClear, save}) {
  const [text,setText]=useState('')
  const [error,setError]=useState('')
  const [last,setLast]=useState(null)
  const input=useRef(null)
  const objects=sceneObjects(model,config)
  const item=objects.find(o=>o.id===selected)
  const stale=preview && preview.revision!==revision
  function suggest(value) { setText(value);setError('');requestAnimationFrame(()=>input.current?.focus()) }
  function ask(e) {
    e.preventDefault()
    try {
      const change=proposeSceneChange(model,config,text,item?.id)
      setError('');setPreview({...change,revision,message:text})
    } catch(e){ setError(e.message) }
  }
  async function keep() {
    if (stale || !await save(preview.model,preview.revision)) return
    setLast({message:preview.message,reply:preview.reply})
    setPreview(null);setText('');onClear()
    requestAnimationFrame(()=>input.current?.focus())
  }
  const examples = objects.map(o => 'Set ' + o.caption + ' to ')
  if (model.kind==='moon-gallery') examples.push('Hang ' + objects.at(-1).label + ' after ' + objects[0].label)
  return <Box component="aside" aria-label="Conversation with Slatebox" sx={{mt:2,mx:'auto',maxWidth:720,borderTop:1,borderColor:'divider',pt:2}}>
    <Typography component="h2" variant="h6">Slatebox</Typography>
    <Typography variant="caption">Direct scene edits</Typography>
    {last && !preview && <Typography variant="body2" sx={{mt:1}}><strong>{last.message}</strong> · {last.reply}</Typography>}
    {preview ? <Box aria-live="polite" sx={{mt:1}}>
      <Typography><strong>{preview.message}</strong></Typography>
      <Typography>{stale?'The scene changed. Discard this preview and try again.':preview.reply}</Typography>
      <Button disabled={saving||stale} onClick={keep}>Keep change</Button>
      <Button disabled={saving} onClick={()=>{setPreview(null);requestAnimationFrame(()=>input.current?.focus())}}>Discard preview</Button>
    </Box> : <Box component="form" onSubmit={ask} sx={{mt:1}}>
      <Typography variant="body2">Choose an item or describe the change you want to try.</Typography>
      {item && <Typography variant="body2">Selected · {item.label} <Button size="small" onClick={onClear}>Clear selection</Button></Typography>}
      <Box sx={{display:'flex', flexWrap:'wrap',gap:.5,my:1}}>{examples.map((s,i)=><Button size="small" key={objects[i]?.id || 'route'} onClick={()=>suggest(s)}>{objects[i]?.caption || 'Change hanging order'}</Button>)}</Box>
      <TextField inputRef={input} autoFocus={Boolean(item)} fullWidth size="small" label="Message Slatebox" value={text}
        placeholder={item?'Rename it to …':'Set '+objects[0].caption+' to …'} inputProps={{maxLength:500}} onChange={e=>setText(e.target.value)} />
      <Button type="submit" disabled={saving||!text.trim()}>Preview change</Button>
    </Box>}
    {error && <Typography role="alert" color="error">{error}</Typography>}
  </Box>
}
