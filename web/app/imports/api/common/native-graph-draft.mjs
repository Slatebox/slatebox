// What a model is shown of the current drawing: the notes most relevant to the request (at
// most 24, text only, up to 240 characters each) and the arrows between them. Raw SVG, URLs,
// styles, account data and other metadata never leave the server.
export function nativeDrawingContext(board, request) {
  const terms=new Set(request.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
  const candidates=(board.nodes || []).flatMap((node,index)=>{
    const {id,text}=node.options || {}
    if(typeof id!=='string'||!id||typeof text!=='string'||!text.trim())return []
    const label=text.trim().slice(0,240)
    const score=(label.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(word=>terms.has(word)).length
    return [{id,label,index,score}]
  })
  const selected=candidates.sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,24)
  const refs=new Map(selected.map(item=>[item.id,'note-'+(item.index+1)]))
  const edges=new Map()
  for(const node of board.nodes||[]) for(const edge of node.relationships?.associations||[]) {
    const from=refs.get(edge.parentId),to=refs.get(edge.childId)
    if(from && to && from!==to && edges.size<48) edges.set(from+':'+to,{from,to})
  }
  return {notes:selected.map(item=>({ref:refs.get(item.id),text:item.label})),connections:[...edges.values()],omittedNotes:candidates.length-selected.length}
}
