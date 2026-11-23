/* eslint-disable no-underscore-dangle */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Grid from '@mui/material/Grid2'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import { useAtom, useAtomValue } from 'jotai'
import { useTracker } from 'meteor/react-meteor-data'
import CONSTANTS from '../../../api/common/constants'
import {
  currentSlate,
  slateHuddleType,
  currentSlateName,
  slateNameProblem,
  areTemplateDetailsOpen,
} from '../../jotai/atoms'

import { ApprovalRequests, Organizations } from '../../../api/common/models'
import TemplateDetails from '../TemplateDetails'
import { Link } from '@mui/material'

export default function SlateSettings({ onChange }) {
  const slate = useAtomValue(currentSlate)
  const [getTemplateDetails, setTemplateDetails] = useAtom(
    areTemplateDetailsOpen
  )
  const [getSlateName, setSlateName] = useAtom(currentSlateName)
  const [nameProblem, setNameProblem] = useAtom(slateNameProblem)
  const [getSlateHuddleType, setSlateHuddleType] = useAtom(slateHuddleType)
  const [slateDescription, setSlateDescription] = React.useState(
    slate?.options?.description
  )

  const [showGrid, setSlateShowGrid] = React.useState(
    slate?.options?.viewPort?.showGrid
  )
  const [snapToObjects, setSlatesnapToObjects] = React.useState(
    slate?.options?.viewPort?.snapToObjects
  )
  const [isFollowMe, setSlateFollowMe] = React.useState(
    slate?.options?.followMe
  )
  const [mindMapMode, setSlateMindMapMode] = React.useState(
    slate?.options?.mindMapMode
  )
  const [isTemplate, setSlateTemplate] = React.useState(
    slate?.options?.isTemplate
  )
  const [savingTemplate, setSavingTemplate] = React.useState(false)
  const [templateError, setTemplateError] = React.useState('')
  const [autoResizeNodesBasedOnText, setAutoResizeNodesBasedOnText] =
    React.useState(slate?.options?.autoResizeNodesBasedOnText)

  const isTheme = slate?.options?.eligibleForThemeCompilation

  useEffect(() => {
    if (isTheme) {
      // when creating a theme, just display temporarily so the user understands
      if (mindMapMode) {
        document.querySelectorAll('.association').forEach((el) => {
          const ele = el
          ele.style.display = 'block'
        })
      } else {
        document.querySelectorAll('.association').forEach((el) => {
          const ele = el
          ele.style.display = 'none'
        })
      }
    }
  }, [mindMapMode, isTheme])

  const showTemplateProperties = (e) => {
    setTemplateDetails({ open: true })
  }

  const setShowGrid = (e) => {
    setSlateShowGrid(e.target.checked)
    onChange({
      type: 'onSlateShowGridChanged',
      data: { showGrid: e.target.checked },
    })
  }

  const setSnapToObjects = (e) => {
    setSlatesnapToObjects(e.target.checked)
    onChange({
      type: 'onSlateSnapToObjectsChanged',
      data: { snapToObjects: e.target.checked },
    })
  }

  const setFollowMe = (e) => {
    setSlateFollowMe(e.target.checked)
    onChange({
      type: 'onSlateFollowMeChanged',
      data: { followMe: e.target.checked },
    })
  }

  const setHuddleType = (val) => {
    setSlateHuddleType(val)
    // setHuddleEnabled(false)
    onChange({
      type: 'onSlateHuddleChanged',
      data: {
        huddleType: val,
        huddleEnabled: false,
      },
    })
  }

  const setMindMap = (e) => {
    setSlateMindMapMode(e.target.checked)
    onChange({
      type: 'onSlateMindMapModeChanged',
      data: { mindMapMode: e.target.checked },
    })
  }

  const setAutoResize = (e) => {
    setAutoResizeNodesBasedOnText(e.target.checked)
    onChange({
      type: 'onSlateAutoResizeNodesBasedOnTextChanged',
      data: { autoResizeNodesBasedOnText: e.target.checked },
    })
  }

  const setTemplate = async (e) => {
    const enabled = e.target.checked
    setSavingTemplate(true)
    setTemplateError('')
    try {
      const committed = await Meteor.callAsync('templates.setDraft', slate.shareId, enabled)
      setSlateTemplate(committed)
      onChange({ type: 'onSlateTemplateChanged', data: { isTemplate: committed } })
    } catch (err) {
      setTemplateError(err.reason || 'Could not change the template setting.')
    } finally {
      setSavingTemplate(false)
    }
  }

  const setName = (e) => {
    setNameProblem('')
    setSlateName(e.target.value)
  }

  const setDescription = (e) => {
    setSlateDescription(e.target.value)
    onChange({
      type: 'onSlateDescriptionChanged',
      data: { description: e.target.value },
    })
  }

  const handleTemplateRequest = async () => {
    await ApprovalRequests.insertAsync({
      slateId: slate.options.id,
      type: 'template',
      userId: Meteor.userId(),
      approved: false,
      message: 'Your approval status is pending...',
    })
  }

  const handleThemeRequest = async () => {
    await ApprovalRequests.insertAsync({
      slateId: slate.options.id,
      type: 'theme',
      userId: Meteor.userId(),
      approved: false,
      message: 'Your approval status is pending...',
    })
  }

  const templateApproval = useTracker(() => {
    Meteor.subscribe(
      CONSTANTS.publications.approvalRequests,
      'template',
      slate?.options?.id
    )
    return ApprovalRequests.findOne()
  })

  const cancelTemplateRequest = async () => {
    await ApprovalRequests.removeAsync({ _id: templateApproval?._id })
  }

  const themeApproval = useTracker(() => {
    Meteor.subscribe(
      CONSTANTS.publications.approvalRequests,
      'theme',
      slate?.options?.id
    )
    return ApprovalRequests.findOne()
  })

  const cancelThemeRequest = async () => {
    await ApprovalRequests.removeAsync({ _id: themeApproval?._id })
  }

  SlateSettings.propTypes = {
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Grid container alignItems="center" justifyContent="flex-start" spacing={1}>
      <Grid size={12}>
        <TextField
          label="Name"
          variant="outlined"
          onChange={setName}
          value={getSlateName}
          error={Boolean(nameProblem)}
          helperText={nameProblem || undefined}
          // A workshop names its slate, and a workshop's title has at most 120 characters.
          slotProps={{ htmlInput: slate?.workshopTitled ? { maxLength: 120 } : {}, formHelperText: { role: 'alert' } }}
          fullWidth
        />
      </Grid>
      {/* A workshop slate's description is written from its workshop: the title, lanes and cards. */}
      {!slate?.workshopTitled && (
        <Grid size={12}>
          <TextField
            label="Description"
            multiline
            minRows={3}
            value={slateDescription}
            onChange={setDescription}
            variant="outlined"
            fullWidth
          />
        </Grid>
      )}
      <Grid size={8}>
        <Typography variant="body2">Mind Map Mode</Typography>
      </Grid>
      <Grid size={4}>
        <Tooltip
          title="Mind Map Mode - join added nodes by connecting lines"
          placement="top"
          aria-label="mindMapMode"
        >
          <Switch onChange={setMindMap} checked={mindMapMode} />
        </Tooltip>
      </Grid>
      <Grid size={8}>
        <Typography variant="body2">Auto Resize Nodes By Text</Typography>
      </Grid>
      <Grid size={4}>
        <Tooltip
          title="Auto Resize Nodes Based On Text - auto resizes nodes to fit the text within"
          placement="top"
          aria-label="autoResizeNodesBasedOnText"
        >
          <Switch
            onChange={setAutoResize}
            checked={autoResizeNodesBasedOnText}
          />
        </Tooltip>
      </Grid>
      {!isTheme ? (
        <>
          <Grid size={12}>
            <Select
              value={getSlateHuddleType}
              size="small"
              onChange={(e) => {
                setHuddleType(e.target.value)
              }}
              variant="outlined"
            >
              <MenuItem key="disabled" value="disabled">
                Disable Huddling
              </MenuItem>
              <MenuItem key="audio" value="audio">
                Allow Audio-Only Huddles
              </MenuItem>
              <MenuItem key="video" value="video">
                Allow Full Video Huddles
              </MenuItem>
            </Select>
          </Grid>
          <Grid size={8}>
            <Typography variant="body2">Show Grid</Typography>
          </Grid>
          <Grid size={4}>
            <Tooltip
              title="Show underlying grid"
              placement="top"
              aria-label="setShowGrid"
            >
              <Switch onChange={setShowGrid} checked={showGrid} />
            </Tooltip>
          </Grid>
          <Grid size={8}>
            <Typography variant="body2">Snap to Neighbors</Typography>
          </Grid>
          <Grid size={4}>
            <Tooltip
              title="Automatically align objects to their neighbors"
              placement="top"
              aria-label="setSnapToObjects"
            >
              <Switch onChange={setSnapToObjects} checked={snapToObjects} />
            </Tooltip>
          </Grid>
          <Grid size={8}>
            <Typography variant="body2">&#34;Follow Me&#34; Mode</Typography>
          </Grid>
          <Grid size={4}>
            <Tooltip
              title="Synchronize the position of the canvas during collaboration"
              placement="top"
              aria-label="setFollowMe"
            >
              <Switch onChange={setFollowMe} checked={isFollowMe} />
            </Tooltip>
          </Grid>
          <Grid size={8}>
            <Typography variant="body2">Is Template</Typography>
          </Grid>
          <Grid size={4}>
            <Tooltip
              title="Mark slate as a template "
              placement="top"
              aria-label="markSlateAsTemplate"
            >
              <Switch onChange={setTemplate} checked={Boolean(isTemplate)}
                disabled={savingTemplate || !slate?.shareId || slate?.userId !== Meteor.userId()} />
            </Tooltip>
          </Grid>
          {templateError && <Grid size={12}><Typography role="alert">{templateError}</Typography></Grid>}
          {isTemplate && (
            <Grid size={12}>
              <Button
                fullWidth="true"
                variant="outlined"
                onClick={showTemplateProperties}
              >
                Provide Details
              </Button>
              <Typography variant="body2">
                <p>
                  Templates provide re-usable slates that center around a theme
                  (e.g., product roadmap, user stories, swot analysis, etc).
                </p>
                {!templateApproval && (
                  <p>
                    Click the below button to request approval for this
                    template. When approved, it will be available for others to
                    use.
                  </p>
                )}
              </Typography>
            </Grid>
          )}
          {isTemplate && (
            <Grid size={12}>
              {!templateApproval && (
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={handleTemplateRequest}
                >
                  Request Template Approval
                </Button>
              )}
              {templateApproval?.approved && (
                <p>
                  Hooray! Your template is{' '}
                  <Link href="/templates">approved and available</Link>.
                </p>
              )}
              {templateApproval && !templateApproval?.approved && (
                <>
                  <p>{templateApproval?.message}</p>
                  <Button
                    variant="outlined"
                    color="secondary"
                    onClick={() => {
                      cancelTemplateRequest()
                    }}
                  >
                    Cancel Request
                  </Button>
                </>
              )}
            </Grid>
          )}
        </>
      ) : (
        <>
          <Grid size={12}>
            <Typography variant="body2">
              <p>Themes provide opinionated styles to existing slates.</p>
              {!themeApproval && (
                <p>
                  Click the below button to request approval for this theme.
                  When approved, it will be available for others to use.
                </p>
              )}
            </Typography>
          </Grid>
          <Grid size={12}>
            {!themeApproval && (
              <Button
                variant="outlined"
                color="secondary"
                onClick={handleThemeRequest}
              >
                Request Theme Approval
              </Button>
            )}
            {themeApproval?.approved && (
              <p>
                Hooray! Your theme is{' '}
                <a href="/themes" style={{ color: '#fff' }}>
                  approved and available
                </a>
                .
              </p>
            )}
            {themeApproval && !themeApproval?.approved && (
              <>
                <p>{themeApproval?.message}</p>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={(e) => {
                    cancelThemeRequest()
                  }}
                >
                  Cancel Request
                </Button>
              </>
            )}
          </Grid>
        </>
      )}
      <TemplateDetails
        open={getTemplateDetails.open}
        shareId={slate?.shareId}
        initialContent={slate?.options?.templateMarkdown || ''}
        aiPrompt={slate?.options?.templatePrompt || ''}
        slateTags={slate?.options?.tags || []}
        onTemplateDetailsChanged={({ tags, markdown, templatePrompt }) => {
          // console.log('changing', tags, markdown, templatePrompt)
          onChange({
            type: 'onSlateTagsAndTemplateMarkdownChanged',
            data: {
              tags,
              templateMarkdown: markdown,
              templatePrompt,
            },
          })
        }}
        onClose={(e) => {
          setTemplateDetails({ open: false })
        }}
      />
    </Grid>
  )
}
