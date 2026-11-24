// One logo in the kit: what it's for, the logo on a light and a dark tile, and a compact place to drop
// or choose a file. Files go to the same upload route as before (/sbupload/image, signed in with the
// login token), and the logo is saved as the same organizationSettings item.
import React, { useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import UploadIcon from '@mui/icons-material/FileUploadOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import uploadHeaders from '../../../api/client/uploadHeaders'
import { LOGO_TYPES_ACCEPTED, logoFileProblem } from './brandKit.mjs'

function upload(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/sbupload/image')
    Object.entries(uploadHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText || 'The upload failed.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

const tile = (dark) => ({
  flex: 1, minWidth: 0, height: 76, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1.25,
  bgcolor: dark ? '#1b2420' : '#ffffff', border: '1px solid', borderColor: dark ? '#1b2420' : '#e1e3d6',
  backgroundImage: dark ? 'none' : 'linear-gradient(45deg,#f4f4ef 25%,transparent 25%,transparent 75%,#f4f4ef 75%),linear-gradient(45deg,#f4f4ef 25%,transparent 25%,transparent 75%,#f4f4ef 75%)',
  backgroundSize: '14px 14px', backgroundPosition: '0 0, 7px 7px',
})

export default function LogoField({ type, logo, onUploaded, onRemove, disabled }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const take = async (file) => {
    setError('')
    const problem = logoFileProblem(file)
    if (problem) { setError(problem); return }
    setProgress(0)
    try {
      const url = await upload(file, setProgress)
      await onUploaded({ file, url })
    } catch (e) {
      setError(e.message || 'The upload failed.')
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }

  const drop = (e) => {
    e.preventDefault()
    setOver(false)
    if (disabled || progress !== null) return
    const file = e.dataTransfer?.files?.[0]
    if (file) take(file)
  }

  return (
    <Box data-logo-field={type.key} sx={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>{type.name}</Typography>
        <Typography variant="caption" color="text.secondary">{type.use}</Typography>
      </Box>
      {logo?.url ? (
        <Box sx={{ display: 'flex', gap: 1, position: 'relative' }}>
          <Box sx={tile(false)}><Box component="img" src={logo.url} alt={`${type.name} on light`} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></Box>
          <Box sx={tile(true)}><Box component="img" src={logo.url} alt={`${type.name} on dark`} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></Box>
          {!disabled && !confirming && (
            <IconButton size="small" aria-label={`Remove the ${type.name.toLowerCase()}`} title="Remove" onClick={() => setConfirming(true)} data-logo-remove={type.key}
              sx={(theme) => ({ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(255,255,255,.92)', border: '1px solid #e1e3d6', '&:hover': { bgcolor: '#fff' },
                ...theme.applyStyles('dark', { bgcolor: 'rgba(35,54,45,.92)', borderColor: '#3a5244', '&:hover': { bgcolor: '#23362d' } }) })}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      ) : null}
      <Box
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${logo?.url ? 'Replace' : 'Add'} the ${type.name.toLowerCase()}: drop a file or choose one`}
        aria-disabled={disabled || undefined}
        data-logo-drop={type.key}
        onClick={() => !disabled && progress === null && input.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); input.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        sx={(theme) => ({
          display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '10px', cursor: disabled ? 'default' : 'pointer',
          border: '1.5px dashed', borderColor: over ? 'primary.main' : '#cfd3c3', bgcolor: over ? 'action.hover' : 'transparent',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          ...theme.applyStyles('dark', { borderColor: over ? 'primary.main' : '#4a6556' }),
        })}
      >
        <UploadIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
          {logo?.url ? <>Drop a new file, or <u>choose one</u>. Replacing can&apos;t be undone.</> : <>Drop a file here, or <u>choose one</u></>}
        </Typography>
      </Box>
      <input ref={input} type="file" hidden accept={LOGO_TYPES_ACCEPTED} onChange={(e) => e.target.files?.[0] && take(e.target.files[0])} data-logo-input={type.key} />
      {progress !== null && <LinearProgress variant="determinate" value={progress} aria-label={`Uploading the ${type.name.toLowerCase()}`} />}
      {error && <Typography role="alert" variant="body2" color="error">{error}</Typography>}
      {logo?.url && !disabled && confirming && (
        <Box role="alertdialog" aria-label={`Remove the ${type.name.toLowerCase()}?`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
            Remove it{type.used ? ' from presentations' : ''}? Undo can&apos;t bring a logo back: you would upload it again.
          </Typography>
          <Button size="small" onClick={() => setConfirming(false)}>Keep</Button>
          <Button size="small" color="error" variant="outlined" data-logo-remove-confirm={type.key} onClick={async () => { setConfirming(false); await onRemove() }}>Remove</Button>
        </Box>
      )}
    </Box>
  )
}
LogoField.propTypes = {
  type: PropTypes.shape({ key: PropTypes.string, name: PropTypes.string, use: PropTypes.string, used: PropTypes.bool }).isRequired,
  logo: PropTypes.shape({ url: PropTypes.string, name: PropTypes.string }),
  onUploaded: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
LogoField.defaultProps = { logo: null, disabled: false }
