// The welcome assistant (server/methods/openai.js) still offers the approved template slates it
// knows by share id. This is its eligibility rule, and nothing else: the public template gallery,
// its directory and its links are gone (the shared library replaced them, server/library).
export function userSelectableTemplateSelector(additional = {}) {
  return {
    ...additional,
    'options.isTemplate': true,
    'options.templateApproved': true,
  }
}

export function isUserSelectableTemplate(template) {
  return Boolean(
    template &&
    template.options?.isTemplate === true &&
    template.options?.templateApproved === true
  )
}
