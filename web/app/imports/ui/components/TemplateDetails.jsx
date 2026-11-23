import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Dialog from '@mui/material/Dialog'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import { useAtom } from 'jotai'
import Grid from '@mui/material/Grid2'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import Container from '@mui/material/Container'
import CloseIcon from '@mui/icons-material/Close'
import ShareIcon from '@mui/icons-material/Share'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'

import Chip from '@mui/material/Chip'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import MarkdownIt from 'markdown-it'
import MdEditor from 'react-markdown-editor-lite'
import 'react-markdown-editor-lite/lib/index.css'
import SlideTransition from './SlideTransition'

import TabPanel from '../common/TabPanel'
import { globalMessage } from '../jotai/atoms'

export default function TemplateProperties({
  open,
  shareId,
  initialContent,
  aiPrompt,
  slateTags,
  onClose,
  onTemplateDetailsChanged,
}) {
  const [content, setContent] = React.useState(initialContent)
  const [templateTags, setTemplateTags] = React.useState(slateTags)
  const [templatePrompt, setTemplatePrompt] = React.useState(aiPrompt)
  const [message, setGlobalMessage] = useAtom(globalMessage)

  /*
 function matchCategsWithRectangles(categs, rectangles) {
  const matched = {};

  categs.forEach(categ => {
    rectangles.forEach(rectangle => {
      if (
        categ.xPos >= rectangle.xPos &&
        categ.xPos + categ.width <= rectangle.xPos + rectangle.width &&
        categ.yPos >= rectangle.y &&
        categ.yPos + categ.height <= rectangle.y + rectangle.height
      ) {
        if (!matched[categ.text]) { matched[categ.text] = { 
          top: rectangle.xPos, 
          left: rectangle.yPos, 
          bottom: rectangle.xPos + rectangle.width, 
          right: rectangle.yPos + rectangle.height 
        }
      }
    });
  });

  return matched;
}
*/

  const handleClose = () => {
    onClose()
  }

  const handleSaveAndClose = () => {
    onTemplateDetailsChanged({
      tags: templateTags,
      markdown: content,
      templatePrompt,
    })
    onClose()
  }

  const mdParser = new MarkdownIt(/* Markdown-it options */)

  function handleEditorChange({ html, text }) {
    setContent(text)
  }

  // console.log('template slate markdown', initialContent)

  const [tabValue, setTabValue] = React.useState(0)
  const changeTab = async (event, newValue) => {
    setTabValue(newValue)
  }

  const [tags, setTags] = useState([])
  useEffect(() => {
    if (!open) return
    let active = true
    Meteor.callAsync('templates.directory', 'list').then(
      directory => { if (active) setTags(directory.tags) },
      () => { if (active) setTags([]) },
    )
    return () => { active = false }
  }, [open])

  function tagsChanged(e, newValue) {
    setTemplateTags(newValue)
  }

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={handleClose}
      TransitionComponent={SlideTransition}
      PaperProps={{ sx: { backgroundColor: '#333', opacity: 0.9 } }}
    >
      <AppBar sx={{ position: 'relative' }}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={handleClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={{ ml: 2, flex: 1 }}>
            Template Details &middot;
            <Button
              href={shareId ? `/templates/preview/${encodeURIComponent(shareId)}` : undefined}
              disabled={!shareId}
              target="_blank" rel="noopener"
            >
              Preview saved template &rarr;
            </Button>
          </Typography>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="xl" sx={{ mt: 2 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <Tabs
            value={tabValue}
            onChange={changeTab}
            indicatorColor="secondary"
            textColor="secondary"
            sx={{ width: '100%' }}
          >
            <Tab label="Expanded Description" />
            <Tab label="Tags" />
            <Tab label="AI Settings" />
          </Tabs>
          <TabPanel value={tabValue} index={0} sx={{ width: '95%' }}>
            <Box p={1}>
              <Typography variant="h6" color="secondary">
                Provide an extended description in markdown format
              </Typography>
            </Box>
            <Box display="flex" pt={4}>
              <MdEditor
                style={{ height: '650px', width: '100%' }}
                value={content}
                renderHTML={(text) => mdParser.render(text)}
                onChange={handleEditorChange}
              />
            </Box>
          </TabPanel>
          <TabPanel value={tabValue} index={1} sx={{ width: '95%' }}>
            <Box p={1}>
              <Typography variant="h6" color="secondary">
                Provide tags that best describe this template
              </Typography>
            </Box>
            <Box p={5}>
              <Autocomplete
                multiple
                id="tags-outlined"
                options={tags.map((t) => t.title)}
                getOptionLabel={(option) => option}
                defaultValue={templateTags}
                freeSolo
                onChange={tagsChanged}
                value={templateTags}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    variant="outlined"
                    color="secondary"
                    label="Slate Template Tags"
                    placeholder="Provide tags that describe this template's categories"
                  />
                )}
              />
            </Box>
          </TabPanel>
          <TabPanel value={tabValue} index={2} sx={{ width: '95%' }}>
            <Box p={1}>
              <Typography variant="h6" color="secondary">
                AI Settings
              </Typography>
            </Box>
            <Box p={5}>
              <TextField
                id="txtAIPrompt"
                fullWidth
                multiline
                variant="outlined"
                value={templatePrompt}
                onChange={(e) => {
                  setTemplatePrompt(e.target.value)
                }}
                InputLabelProps={{
                  sx: { color: '#fff' },
                }}
              />
            </Box>
          </TabPanel>
        </Box>
        <Box display="flex" justifyContent="center">
          <Button variant="outlined" size="large" onClick={handleClose}>
            Cancel
          </Button>
          &nbsp;
          <Button variant="outlined" size="large" onClick={handleSaveAndClose}>
            Save
          </Button>
        </Box>
      </Container>
    </Dialog>
  )
}
