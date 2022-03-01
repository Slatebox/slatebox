import Button from '@material-ui/core/Button'
import Dialog from '@material-ui/core/Dialog'
import DialogActions from '@material-ui/core/DialogActions'
import DialogContent from '@material-ui/core/DialogContent'
import DialogTitle from '@material-ui/core/DialogTitle'
import Typography from '@material-ui/core/Typography'
import React, { Component } from 'react'
import { ThemeProvider } from '@material-ui/core/styles'
import { render } from 'react-dom'

let resolve
class Confirm extends Component {
  static create(props = {}) {
    const containerElement = document.createElement('div')
    document.body.appendChild(containerElement)
    return render(<Confirm createConfirmProps={props} />, containerElement)
  }

  constructor() {
    super()
    this.state = {
      isOpen: false,
      showConfirmProps: {},
    }
    this.handleClose = this.handleClose.bind(this)
    this.show = this.show.bind(this)
  }

  async handleAction(a) {
    this.setState({ isOpen: false })
    if (a.process) {
      await a.process()
    }
    resolve(a.return)
  }

  handleClose(e) {
    this.setState({ isOpen: false })
    resolve(false)
  }

  show(props = {}) {
    // eslint-disable-next-line react/destructuring-assignment
    const showConfirmProps = { ...this.props.createConfirmProps, ...props }
    this.setState({ isOpen: true, showConfirmProps })
    return new Promise((res) => {
      resolve = res
    })
  }

  render() {
    const { isOpen, showConfirmProps } = this.state
    const {
      theme,
      message,
      title,
      actionItems = [
        { key: 'yes', label: 'Yes', return: true },
        { key: 'no', label: 'No', return: false },
      ],
    } = showConfirmProps
    return (
      <div>
        {theme && (
          <ThemeProvider theme={theme}>
            <Dialog
              onClose={this.handleClose}
              aria-labelledby="customized-dialog-title"
              open={isOpen}
              fullWidth
              maxWidth="sm"
            >
              <DialogTitle style={{ color: theme?.palette?.secondary?.main }}>
                {title}
              </DialogTitle>
              <DialogContent dividers>
                <Typography
                  gutterBottom
                  dangerouslySetInnerHTML={{ __html: message }}
                />
              </DialogContent>
              <DialogActions>
                {actionItems.map((a) => (
                  <Button
                    key={a.key}
                    variant="outlined"
                    color="secondary"
                    onClick={() => {
                      this.handleAction(a)
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </DialogActions>
            </Dialog>
          </ThemeProvider>
        )}
      </div>
    )
  }
}

export default Confirm
