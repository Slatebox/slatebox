// The payment fields drawn in Slatebox's colours and type (design §5.3): the MUI theme mapped to the
// processor's Appearance API. The theme names 'stripe' and 'night' are its built-in base themes. Pure.

export const PAY_FONTS = Object.freeze([{ cssSrc: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700' }])

export function stripeAppearance({ mode, palette }) {
  const dark = mode === 'dark'
  const primary = palette.primary.main
  return {
    theme: dark ? 'night' : 'stripe',
    variables: {
      colorPrimary: primary,
      colorBackground: palette.background.paper,
      colorText: palette.text.primary,
      colorTextSecondary: palette.text.secondary,
      colorDanger: dark ? '#ffb4a8' : '#a1352b',
      fontFamily: 'Manrope, system-ui, sans-serif',
      fontSizeBase: '15px',
      borderRadius: '10px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': { border: `1px solid ${palette.divider}`, boxShadow: 'none' },
      '.Input:focus': { borderColor: primary, boxShadow: `0 0 0 1px ${primary}` },
      '.Label': { fontWeight: '600', fontSize: '13px' },
      '.Tab--selected, .AccordionItem--selected': { borderColor: primary },
    },
  }
}
