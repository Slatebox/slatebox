import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import {
  SIZES, sizeChoice, sizePackage, FONTS, fontChoice, fontPackage, boldPackage, shared, selectionStyle, autoTextColour,
  isAutoText, fillPackages, borderPackages, textColourPackage, effectPackage, animationPackage, imagePackage,
  imageFromGeneration, linkPackage, lineValues, linePackage, LINE_WIDTHS, copyStyleOf, pasteStylePackages,
  barControls, moreRows, alignPackage, shapePackage, tooltipFine, fillOf, recentColoursAfter, lockPackage,
  orderPackage, panelsStillShown, DEFAULT_SWATCHES, effectName, colourName, LINE_SWATCHES, contrast, forNote, effectsSummary,
} from '../web/app/imports/api/common/note-style.mjs'

const note = (options) => ({ options: { id: 'n', text: 'Keep me', fontSize: 18, backgroundColor: '#fbdfac', fontColor: '#1b1f1d', ...options } })

test('text sizes are S, M, L and XL; any other size is Custom with its number', () => {
  assert.deepEqual(SIZES.map(s => [s.key, s.size]), [['S', 14], ['M', 18], ['L', 28], ['XL', 44]])
  assert.deepEqual(sizeChoice(14), { key: 'S' })
  assert.deepEqual(sizeChoice(44), { key: 'XL' })
  assert.deepEqual(sizeChoice(22), { key: 'custom', size: 22 })
  // A size in points is drawn in points (1pt = 4/3px), so it is shown in the pixels it is drawn at.
  assert.deepEqual(sizeChoice('22pt'), { key: 'custom', size: 29.3 })
  assert.deepEqual(sizeChoice(undefined), { key: null })
  // A size package carries the size and nothing else: never the text, never the shape.
  assert.deepEqual(sizePackage(28), { type: 'onNodeTextChanged', data: { fontSize: 28 } })
  assert.equal(sizePackage(0), null)
  assert.equal(sizePackage(9999), null)
})

test('four fonts by name, in their own lettering; another font shows as Other', () => {
  assert.deepEqual(FONTS.map(f => [f.key, f.name, f.family]), [
    ['clean', 'Clean', 'Manrope'], ['book', 'Book', 'Lora'], ['typewriter', 'Typewriter', 'Courier Prime'], ['handwritten', 'Handwritten', 'Caveat']])
  assert.deepEqual(fontChoice('Manrope'), { key: 'clean', name: 'Clean' })
  assert.deepEqual(fontChoice("'Lora', serif"), { key: 'book', name: 'Book' })
  assert.deepEqual(fontChoice('Arial, sans-serif'), { key: 'other', name: 'Other: Arial' })
  assert.deepEqual(fontChoice(undefined), { key: 'clean', name: 'Clean' })
  assert.deepEqual(fontPackage('handwritten'), { type: 'onNodeTextChanged', data: { fontFamily: 'Caveat' } })
  assert.deepEqual(boldPackage(true), { type: 'onNodeTextChanged', data: { fontWeight: 'bold' } })
  assert.deepEqual(boldPackage(false), { type: 'onNodeTextChanged', data: { fontWeight: 'normal' } })
})

test('several notes: a shared value, or mixed', () => {
  assert.deepEqual(shared([1, 1, 1]), { value: 1, mixed: false })
  assert.deepEqual(shared([1, 2]), { value: undefined, mixed: true })
  assert.deepEqual(shared([]), { value: undefined, mixed: false })
  const style = selectionStyle([note({ backgroundColor: '#fff' }), note({ backgroundColor: '#000', fontSize: 18 })])
  assert.equal(style.fill.mixed, true)
  assert.deepEqual(style.size, { value: 18, mixed: false })
  // A gradient fill is shown by both its colours.
  assert.deepEqual(fillOf({ backgroundColor: '#aaaaaa-#bbbbbb' }), { colours: ['#aaaaaa', '#bbbbbb'], colour: '#bbbbbb' })
})

test('text colour Auto picks white on Forest and Ink, dark on light fills, and follows the fill', () => {
  const forest = DEFAULT_SWATCHES.find(s => s.name === 'Forest').colour
  const ink = DEFAULT_SWATCHES.find(s => s.name === 'Ink').colour
  assert.equal(autoTextColour(forest), '#ffffff')
  assert.equal(autoTextColour(ink), '#ffffff')
  assert.equal(autoTextColour('#fbdfac'), '#1b1f1d')
  assert.equal(isAutoText({ backgroundColor: '#fbdfac', fontColor: '#1b1f1d' }), true)
  assert.equal(isAutoText({ backgroundColor: '#fbdfac', fontColor: '#c00000' }), false)
  // Plain white or black from before Auto existed counts as Auto (rgba white on a mid blue, the old default).
  assert.equal(isAutoText({ backgroundColor: '#699bc3', fontColor: 'rgba(255, 255, 255, 0.87)' }), true)
  // A note on Auto turns white with a dark fill: the fill and the text colour go together.
  assert.deepEqual(fillPackages(note({}).options, forest), [
    { type: 'onNodeColorChanged', data: { color: forest, opacity: 1 } },
    { type: 'onNodeTextChanged', data: { fontColor: '#ffffff', textOpacity: 1 } },
  ])
  // A text colour chosen by hand stays.
  assert.deepEqual(fillPackages(note({ fontColor: '#c00000' }).options, forest), [
    { type: 'onNodeColorChanged', data: { color: forest, opacity: 1 } },
  ])
  assert.deepEqual(textColourPackage('auto', { backgroundColor: forest }), { type: 'onNodeTextChanged', data: { fontColor: '#ffffff', textOpacity: 1 } })
})

test('border colour and opacity are sent apart, so neither is lost', () => {
  assert.deepEqual(borderPackages({ colour: '#112233', opacity: 0.5 }), [
    { type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderColor', val: '#112233' } },
    { type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderOpacity', val: 0.5 } },
  ])
  assert.deepEqual(borderPackages({ width: 'thick' }), [{ type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderWidth', val: 6 } }])
  assert.deepEqual(borderPackages({ style: 'dashed' }), [{ type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderStyle', val: '-' } }])
  assert.deepEqual(borderPackages({ style: 'solid' }), [{ type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderStyle', val: null } }])
})

test('effect "None" really clears it (sends an empty id), for text and for the shape', () => {
  assert.deepEqual(effectPackage('text', 'None'), { type: 'onNodeEffectChanged', data: { filter: { apply: 'text', id: '' } } })
  assert.deepEqual(effectPackage('vect', null), { type: 'onNodeEffectChanged', data: { filter: { apply: 'vect', id: '' } } })
  assert.deepEqual(effectPackage('vect', 'dropShadow'), { type: 'onNodeEffectChanged', data: { filter: { apply: 'vect', id: 'dropShadow' } } })
  assert.deepEqual(animationPackage('text', 'none'), { type: 'onNodeEffectChanged', data: { filter: { apply: 'text', isAnimation: true, id: '' } } })
  assert.equal(effectName('postItNote'), 'Sticky note')
  assert.equal(effectName('dropShadow'), 'Shadow')
  assert.equal(effectName(''), 'None')
})

test('a picture: set, cleared, and an error answer changes nothing', () => {
  assert.deepEqual(imagePackage({ link: 'https://x/y.png', image: { width: 400, height: 300 } }),
    { type: 'onNodeImageChanged', data: { img: 'https://x/y.png', w: 400, h: 300 } })
  assert.deepEqual(imagePackage(null), { type: 'onNodeImageChanged', data: { img: null } })
  assert.equal(imageFromGeneration([{ error: true, message: 'You are all out of AI credits' }]), null)
  assert.equal(imageFromGeneration([]), null)
  assert.equal(imageFromGeneration(null), null)
  assert.equal(imageFromGeneration(['https://img/1.png']), 'https://img/1.png')
})

test('a link must be a web address; a bad one is said, not dropped', () => {
  assert.deepEqual(linkPackage('https://slatebox.com/a'), { pkg: { type: 'onNodeLinkAdded', data: { link: { show: true, type: 'url', data: 'https://slatebox.com/a' } } } })
  assert.match(linkPackage('ftp://x').error, /http/)
  assert.match(linkPackage('  ').error, /address/)
  assert.deepEqual(linkPackage(null, { remove: true }), { pkg: { type: 'onNodeLinkRemoved', data: {} } })
})

test('a line reads its own colour, width, opacity and effect, not the note-wide default', () => {
  const owner = { lineColor: '#000000', lineWidth: 9, lineOpacity: 0.3, lineEffect: 'blur' }
  const assoc = { id: 'a->b', lineColor: '#ff0000', lineWidth: 2, lineOpacity: 0, lineEffect: '', lineType: 'orthogonal', showChildArrow: true, showParentArrow: false, lineDash: 'dashed', label: 'leads to' }
  const v = lineValues(assoc, owner)
  assert.equal(v.colour, '#ff0000')
  assert.equal(v.width, 2)
  assert.equal(v.opacity, 0) // an opacity of 0 is shown as 0
  assert.equal(v.effect, '')
  assert.equal(v.elbow, true)
  assert.equal(v.dash, 'dashed')
  assert.equal(v.label, 'leads to')
  assert.deepEqual(LINE_WIDTHS.map(w => w.width), [2, 4, 8])
  assert.deepEqual(linePackage('lineDash', 'dotted', assoc), { type: 'onLinePropertiesChanged', data: { prop: 'lineDash', val: 'dotted', associationId: 'a->b' } })
  assert.deepEqual(linePackage('lineEffect', 'None', assoc).data.val, '')
})

test('several notes never send text, shape or size; alignment and lock are safe', () => {
  const several = barControls([note({}), note({ id: 'm' })])
  assert.equal(several.shape, false)
  assert.equal(several.text, false)
  assert.equal(several.sizes, true)
  assert.deepEqual(alignPackage({ x: 'left' }), { type: 'onNodeTextChanged', data: { textXAlign: 'left' } })
  assert.deepEqual(alignPackage({ y: 'bottom' }), { type: 'onNodeTextChanged', data: { textYAlign: 'bottom' } })
  // A shape change carries the new path and size; the line shape also gets a visible border.
  assert.deepEqual(shapePackage({ path: 'M0 0', hint: 'line', width: 175, height: 100 }), [
    { type: 'onNodeShapeChanged', data: { shape: 'M0 0', hint: 'line', width: 175, height: 100 } },
    { type: 'onNodeBorderPropertiesChanged', data: { prop: 'borderWidth', val: 3 } },
  ])
  assert.deepEqual(lockPackage(true), { type: 'onNodeLocked', data: {} })
  assert.deepEqual(orderPackage('back'), { type: 'onNodeToBack', data: {} })
})

test('a hidden tab (showXTab) removes its whole button or row: no gaps, no empty panel', () => {
  const all = { showColorTab: true, showTextTab: true, showShapeTab: true, showImageTab: true, showEffectTab: true, showAITab: true }
  const full = barControls([note(all)])
  assert.deepEqual([full.fill, full.border, full.textColour, full.sizes, full.align, full.shape, full.ask], [true, true, true, true, true, true, true])
  const noColour = barControls([note({ ...all, showColorTab: false })])
  assert.equal(noColour.fill, false)
  assert.equal(noColour.border, false)
  const noText = barControls([note({ ...all, showTextTab: false })])
  assert.equal(noText.sizes, false)
  assert.equal(noText.align, false)
  assert.equal(noText.textColour, false)
  assert.equal(barControls([note({ ...all, showShapeTab: false })]).shape, false)
  assert.equal(barControls([note({ ...all, showAITab: false })]).ask, false)
  const rows = moreRows([note({ ...all, showImageTab: false, showEffectTab: false })], {})
  assert.equal(rows.some(r => r.key === 'picture'), false)
  assert.equal(rows.some(r => r.key === 'effects'), false)
  assert.equal(rows.some(r => r.key === 'font'), true)
  // Missing flags (a note made before the flags existed) count as shown.
  assert.equal(barControls([note({})]).fill, true)
})

test('a control hidden (or the note locked) while its panel is open closes that panel: it cannot keep restyling', () => {
  const all = { showColorTab: true, showTextTab: true, showShapeTab: true, showImageTab: true, showEffectTab: true, showAITab: true }
  const at = (options) => ({ show: barControls([note(options)]), rows: moreRows([note(options)], {}).map(r => r.key), locked: options.isLocked === true })
  const still = (state, options) => { const { show, rows, locked } = at(options); return panelsStillShown(state, show, rows, locked) }
  // Shown: nothing closes.
  assert.deepEqual(still({ open: 'colour', colourTab: 'fill', moreView: null }, all), { open: 'colour', moreView: null })
  // Exec hides color while Fill colour is open: the popover closes.
  assert.deepEqual(still({ open: 'colour', colourTab: 'fill', moreView: null }, { ...all, showColorTab: false }), { open: null, moreView: null })
  assert.deepEqual(still({ open: 'colour', colourTab: 'text', moreView: null }, { ...all, showTextTab: false }), { open: null, moreView: null })
  assert.deepEqual(still({ open: 'align', moreView: null }, { ...all, showTextTab: false }), { open: null, moreView: null })
  assert.deepEqual(still({ open: 'size', moreView: null }, { ...all, showTextTab: false }), { open: null, moreView: null })
  assert.deepEqual(still({ open: 'shape', moreView: null }, { ...all, showShapeTab: false }), { open: null, moreView: null })
  // A More detail panel whose row is gone goes back to the rows; More stays open.
  assert.deepEqual(still({ open: 'more', moreView: 'picture' }, { ...all, showImageTab: false }), { open: 'more', moreView: null })
  assert.deepEqual(still({ open: 'more', moreView: 'effects' }, { ...all, showEffectTab: false }), { open: 'more', moreView: null })
  assert.deepEqual(still({ open: 'more', moreView: 'font' }, all), { open: 'more', moreView: 'font' })
  // Locked by someone else: the restyling popovers close too (More stays for Locked itself).
  assert.deepEqual(still({ open: 'colour', colourTab: 'fill', moreView: null }, { ...all, isLocked: true }), { open: null, moreView: null })
  assert.deepEqual(still({ open: 'more', moreView: 'font' }, { ...all, isLocked: true }), { open: 'more', moreView: null })
  assert.deepEqual(still({ open: 'arrange', moreView: null }, all), { open: 'arrange', moreView: null })
  // The phone's sheets: a sheet whose button is gone closes; More stays.
  const sheet = (phoneSheet, options) => still({ open: null, moreView: null, phoneSheet }, options).phoneSheet
  assert.equal(sheet('colour', all), 'colour')
  assert.equal(sheet('colour', { ...all, showColorTab: false }), 'colour') // text colour is still there
  assert.equal(sheet('colour', { ...all, showColorTab: false, showTextTab: false }), null)
  assert.equal(sheet('style', { ...all, showTextTab: false, showShapeTab: false }), null)
  assert.equal(sheet('style', { ...all, isLocked: true }), null)
  assert.equal(sheet('more', { ...all, isLocked: true }), 'more')
})

test('More: each row says its current value; Paste style only after Copy style; no behaviour row for anyone', () => {
  const rows = moreRows([note({ fontFamily: 'Lora', isLocked: true, link: { show: true, data: 'https://a.b' } })], { author: false })
  const value = key => rows.find(r => r.key === key)?.value
  assert.equal(value('font'), 'Book')
  assert.equal(value('picture'), 'None')
  assert.equal(value('effects'), 'None')
  assert.equal(value('locked'), 'On')
  assert.equal(value('link'), 'Edit')
  assert.equal(rows.some(r => r.key === 'paste-style'), false)
  assert.equal(rows.some(r => r.key === 'behaviour'), false)
  const withCopy = moreRows([note({})], { copiedStyle: { backgroundColor: '#fff' }, author: true })
  assert.equal(withCopy.some(r => r.key === 'paste-style'), true)
  // The Custom Behavior dialog is retired (owner, 2026-11-21): not even the slate's author gets the row.
  assert.equal(withCopy.some(r => r.key === 'behaviour'), false)
  assert.equal(moreRows([note({ image: 'https://p.png' })], {}).find(r => r.key === 'picture').value, 'Set')
})

test('copy style goes to the selection only, survives notes without filters or a picture, and never carries text', () => {
  const source = note({ backgroundColor: '#123456', borderColor: '#654321', borderWidth: 3, borderStyle: '-', fontSize: 28, fontFamily: 'Lora', fontColor: '#ffffff', fontWeight: 'bold', textXAlign: 'start' })
  const style = copyStyleOf(source.options)
  assert.equal(style.text, undefined)
  const pkgs = pasteStylePackages(style)
  assert.ok(pkgs.length > 0)
  assert.ok(pkgs.every(p => p.data.text === undefined && p.data.width === undefined && p.data.shape === undefined))
  assert.ok(pkgs.some(p => p.type === 'onNodeColorChanged' && p.data.color === '#123456'))
  assert.ok(pkgs.some(p => p.type === 'onNodeTextChanged' && p.data.fontSize === 28 && p.data.fontWeight === 'bold'))
  // No filters and no picture on the source: nothing about them is sent, and nothing throws.
  assert.doesNotThrow(() => pasteStylePackages(copyStyleOf({ id: 'bare' })))
  assert.ok(pasteStylePackages(copyStyleOf({ id: 'bare' })).every(p => p.type !== 'onNodeEffectChanged'))
  const withFilters = pasteStylePackages(copyStyleOf({ filters: { vect: 'dropShadow' } }))
  assert.ok(withFilters.some(p => p.type === 'onNodeEffectChanged' && p.data.filter.id === 'dropShadow'))
})

test('recent colours: newest first, no repeats, at most 7', () => {
  let r = []
  for (const c of ['#111111', '#222222', '#111111']) r = recentColoursAfter(r, c)
  assert.deepEqual(r, ['#111111', '#222222'])
  for (let i = 0; i < 10; i++) r = recentColoursAfter(r, '#00000' + i)
  assert.equal(r.length, 7)
})

test('no tooltip names a keyboard shortcut', () => {
  assert.equal(tooltipFine('Group'), true)
  assert.equal(tooltipFine('Group (⌘G)'), false)
  assert.equal(tooltipFine('Undo (Ctrl+Z)'), false)
  assert.equal(tooltipFine('Delete'), true)
})

test('a new slate\'s default "14pt" note shows the size it is drawn at, never S', () => {
  // 14pt is drawn at 18.7px: the bar must not tick Small (14px), and Custom starts from 18.7.
  assert.deepEqual(sizeChoice('14pt'), { key: 'custom', size: 18.7 })
  assert.deepEqual(sizeChoice('18px'), { key: 'M' })
  assert.deepEqual(sizeChoice('13.5pt'), { key: 'M' })
  assert.equal(selectionStyle([{ fontSize: '14pt' }]).size.value, 18.7)
})

test('every swatch has a readable name, never a hex code', () => {
  for (const hex of ['#f6c4b0', '#24493a', '#1f2a2a', '#ffffff', '#000000', '#dceaf3', '#c62828', '#7f7f7f', '#fdeea6', 'rgb(10, 80, 200)']) {
    const name = colourName(hex)
    assert.ok(name && !/#|rgb|\d/.test(name), `${hex} -> ${name}`)
  }
  assert.equal(colourName('#ffffff'), 'White')
  assert.equal(colourName('#000000'), 'Black')
  assert.match(colourName('#c62828'), /red/i)
  assert.match(colourName('#1f6feb'), /blue/i)
  // A swatch from the default list keeps its own name.
  assert.equal(colourName('#24493a'), 'Forest')
})

test('line colours show up as lines on a light canvas', () => {
  assert.ok(LINE_SWATCHES.length >= 8)
  for (const s of LINE_SWATCHES) {
    assert.ok(!/#/.test(s.name), s.name)
    assert.ok(contrast(s.colour, '#ffffff') >= 3, `${s.name} ${s.colour} is too pale for a line`)
  }
})

test('a locked note takes no style change, only unlock, order and lock', () => {
  const fill = { type: 'onNodeColorChanged', data: { color: '#f6c4b0' } }
  const size = { type: 'onNodeTextChanged', data: { fontSize: 44 } }
  const unlock = { type: 'onNodeUnlocked', data: {} }
  const front = { type: 'onNodeToFront', data: {} }
  assert.deepEqual(forNote({ isLocked: true }, [fill, size, unlock, front]), [unlock, front])
  assert.deepEqual(forNote({ isLocked: false }, [fill, size]), [fill, size])
  assert.deepEqual(forNote({}, [fill]), [fill])
})

test('Effects and animation: text animation is offered again, and the row says every effect that is on', () => {
  assert.equal(effectsSummary({}), 'None')
  assert.equal(effectsSummary({ filters: { vect: 'dropShadow' } }), 'Shadow')
  assert.equal(effectsSummary({ filters: { vect: 'dropShadow', text: 'blur' }, animations: { text: 'pulse' } }, { pulse: { display: 'Pulse' } }), 'Shadow, text Blur, text Pulse')
  const row = moreRows([{ filters: {}, animations: { text: 'pulse' } }]).find((r) => r.key === 'effects')
  assert.match(row.value, /Pulse|pulse/i)
  // Text animation sends the text target.
  assert.deepEqual(animationPackage('text', 'pulse'), { type: 'onNodeEffectChanged', data: { filter: { apply: 'text', isAnimation: true, id: 'pulse' } } })
})

test('text alignment speaks the engine\'s words: left, middle and right across; top, middle and bottom up and down', () => {
  // The engine draws only these (anything else falls back to the centre), and its operations accept only these.
  // slateboxjs is the app's dependency (web/app), not the repository root's.
  const { NODE_KEYS } = createRequire(new URL('../web/app/package.json', import.meta.url))('slateboxjs/operations')
  const across = NODE_KEYS.textXAlign.spec().values
  const upDown = NODE_KEYS.textYAlign.spec().values
  for (const x of across) assert.deepEqual(alignPackage({ x }), { type: 'onNodeTextChanged', data: { textXAlign: x } })
  for (const y of upDown) assert.deepEqual(alignPackage({ y }), { type: 'onNodeTextChanged', data: { textYAlign: y } })
  // Words the engine does not draw are never sent.
  for (const x of ['start', 'end', 'center', 'justify']) assert.equal(alignPackage({ x }), null)
  // What a note holds is shown under the same words; a note drawn from an older default ("center") shows as Centre.
  assert.equal(selectionStyle([{ textXAlign: 'left' }]).alignX.value, 'left')
  assert.equal(selectionStyle([{ textXAlign: 'right' }]).alignX.value, 'right')
  assert.equal(selectionStyle([{ textXAlign: 'center' }]).alignX.value, 'middle')
  assert.equal(selectionStyle([{}]).alignX.value, 'middle')
  assert.equal(moreRows([{ textXAlign: 'right' }], { phone: true }).find((r) => r.key === 'alignment').value, 'Right')
  assert.equal(moreRows([{ textXAlign: 'left' }], { phone: true }).find((r) => r.key === 'alignment').value, 'Left')
})
