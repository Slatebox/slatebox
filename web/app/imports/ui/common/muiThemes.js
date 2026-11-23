import { createTheme } from '@mui/material/styles'

const sbTheme = createTheme({
  shape: { borderRadius: 10 },
  typography: {
    fontSize: 14,
    fontFamily: '"Manrope", system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 650 },
  },
  colorSchemes: {
    light: {
      palette: {
        text: { primary: '#213d32', secondary: '#53685b' },
        background: { default: '#f8f7ef', paper: '#fffef8' },
        divider: '#d3d7c9',
        primary: { main: '#254b3b', dark: '#193529', contrastText: '#ffffff' },
        secondary: { main: '#39604c', contrastText: '#ffffff' },
        thematic: { main: '#39583e', contrastText: '#ffffff', boxShadow: '0 3px 14px #203d321c', borderColor: '#819786' },
        shell: { surface: '#fffef8', ink: '#193c2f', secondaryInk: '#486351', border: '#c6d1bf', selected: '#dce9ce', selectedInk: '#183d28', appBar: '#223e32', main: '#223e32', offset: '#edf0e5', background: '#f8f7ef' },
      },
    },
    dark: {
      palette: {
        text: { primary: '#f5f3e9', secondary: '#bdcdbd' },
        background: { default: '#17251f', paper: '#23362d' },
        divider: '#475e50',
        primary: { main: '#f2ce8b', dark: '#d2aa62', text: '#f2ce8b', contrastText: '#17251f' },
        secondary: { main: '#bed7b5', contrastText: '#17251f' },
        thematic: { main: '#efcf8c', contrastText: '#17251f', boxShadow: '0 3px 14px #11191155', borderColor: '#a8bcaa' },
        shell: { surface: '#1e3027', ink: '#f6f4e8', secondaryInk: '#b9cbb9', border: '#496151', selected: '#3c5344', selectedInk: '#ffe0a4', appBar: '#172b22', main: '#172b22', offset: '#2c4338', background: '#17251f' },
      },
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
        @font-face { font-family: 'Archivo Narrow'; font-weight: 700; font-style: normal; src: url('/brand/ArchivoNarrow-Bold.ttf') format('truetype'); font-display: swap; }
      `,
    },
    MuiButton: { styleOverrides: { root: { borderRadius: 24 }, contained: { boxShadow: 'none' } } },
    MuiAppBar: { styleOverrides: { root: { backgroundImage: 'none', backgroundColor: '#223e32', color: '#fffef8' } } },
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&.MuiTab-textColorPrimary.Mui-selected': {
            ...(theme.palette.mode === 'light' ? {
              color: theme.palette.primary.dark,
              backgroundColor: '#fde6c673',
              fontWeight: 'bold',
            } : {
              color: theme.palette.primary.main,
              backgroundColor: '#f4c37d59',
              fontWeight: 'bold',
            }),
          },
          '&.MuiTab-textColorSecondary.Mui-selected': {
            backgroundColor: '#c8ddf05c',
          },
        }),
      },
    },
    MuiMenuItem: {  
      styleOverrides: {
        root: ({ theme }) => ({
          '&.Mui-selected': {
            ...(theme.palette.mode === 'light' ? {
              backgroundColor: '#d9e1e7',
            } : {
              backgroundColor: '#4e6277',
            }),
          },
          '&.Mui-selected:hover': {
            ...(theme.palette.mode === 'light' ? {
              backgroundColor: '#d0dee9',
            } : {
              backgroundColor: '#435b75',
            }),
          },
        }),
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&.MuiCheckbox-colorPrimary': {
            ...(theme.palette.mode === 'light' && {
              color: theme.palette.primary.dark,
            }),
          },
        }),
      },
    },
    MuiTextField: {
      defaultProps: {
        color: 'secondary',
      },
    },
    MuiSelect: {
      defaultProps: {
        color: 'secondary',
      },
    },
    MuiFormLabel: {
      defaultProps: {
        color: 'secondary',
      },
      styleOverrides: {
        root: ({ theme }) => ({
          '&.MuiFormLabel-colorPrimary.MuiInputLabel-shrink.Mui-focused': {
            ...(theme.palette.mode === 'light' && {
              color: theme.palette.primary.dark,
              fontWeight: 'bold',
            }),
          },
        }),
      },
    },
  },
})

export default sbTheme
