const emptyAIConversation = {
  name: 'New conversation name',
  title: 'New conversation description',
  details: 'New conversation detailed description',
  slateName: '{{items}}',
  gather: {
    title: 'Just a couple details to get started...',
    message: '',
    onComplete: 'populateCenterNode',
    items: [
      {
        placeholder: 'Provide the first piece of data to collect',
        key: 'mainDataKey',
        defaultValue: '',
        type: 'textfield',
        isPrimary: true,
        required: true,
      },
      {
        placeholder: 'Optionally provide more data to collect.',
        key: 'dataKey',
        type: 'textarea',
        required: false,
        additionalPrompts: [
          `You can use this to add to the main prompt and integrate more user supplied data using the id with this syntax: {{dataKey}}.`,
        ],
      },
    ],
    order: 1,
    footerMessage: `What message do you want to put in the footer of the conversation modal?`,
  },
  ai: {
    decisionTree: {
      inline: {
        // engine intentionally absent: the server resolves provider + model via
        // resolveAIFeatureConfig('generation'|'vision') — see server/methods/ai/feature-config.mjs
        layoutType: {
          val: 'twopi',
          overlap: 'scalexy',
        },
        defaultShapes: {
          category: 'circle',
          note: 'stickyNote',
        },
        autoOpenChat: true,
        errorChecks: [
          {
            type: 'noteWordCount',
            limit: 50,
          },
          {
            type: 'noteAndCategoryIdsSet',
          },
        ],
        functions: [
          {
            name: 'respond',
            description: 'This is your response to the last query',
            parameters: {
              type: 'object',
              properties: {
                categories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      description: {
                        type: 'string',
                        description: 'This is one of the 8 main categories.',
                      },
                      id: {
                        type: 'string',
                        description:
                          "Use the lower-case version of this category name with no spaces or capitalizations. This should never be 'main'.",
                      },
                      parentCategoryIds: {
                        type: 'array',
                        items: {
                          type: 'string',
                          description:
                            "What is the functions' parent category id? You can use 'main' if it is connected to the main topic.",
                        },
                      },
                      isUpdate: {
                        type: 'boolean',
                        description:
                          'Are you updating a category or creating a new one? If updating, set this parameter to true, otherwise false',
                      },
                    },
                    required: ['id', 'description', 'isUpdate'],
                  },
                },
                notes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      description: {
                        type: 'string',
                        description: "This is the note's description.",
                      },
                      id: {
                        type: 'string',
                        description:
                          "This is a required unique 8 character string that you generate. This should never be 'main'.",
                      },
                      parentCategoryIds: {
                        type: 'array',
                        items: {
                          type: 'string',
                          description:
                            "What are this notes' parent category id? You can use 'main' if it is connected to the main topic.",
                        },
                      },
                      isUpdate: {
                        type: 'boolean',
                        description:
                          'Are you updating a note or creating a new one? If updating, set this parameter to true, otherwise false',
                      },
                      templateDetails: {
                        type: 'object',
                        properties: {
                          svgString: {
                            type: 'string',
                            description:
                              'This is the entire <svg>...</svg> string that makes up the visualization being requested. Users can ask for special visualizations to be produced (infographics, flowcharts, etc) or perhaps a specific kind of group activity where users can put virtual sticky notes. In either case, be creative and highly specific when producing these visualizations. Whatever is asked for, these visualizations or collaborative exercises need to be highly specific to the context being analyzed. Prior to building the svg, make a plan on how you think it should look to ensure beautiful design, no text overlap, and clarity for the audience and stakeholders you are working with. Always ensure the background of the SVG is white. Be specific in building the SVG visualization with details from the context.',
                          },
                          stickyNotesToCreate: {
                            type: 'number',
                            description:
                              'How many sticky notes should be created?',
                          },
                          width: {
                            type: 'number',
                            description:
                              'What is the width of this template in pixels?',
                          },
                          height: {
                            type: 'number',
                            description:
                              'What is the height of this template in pixels?',
                          },
                        },
                        required: [
                          'svgString',
                          'stickyNotesToCreate',
                          'width',
                          'height',
                        ],
                      },
                    },
                    required: [
                      'id',
                      'description',
                      'parentCategoryIds',
                      'isUpdate',
                    ],
                  },
                },
                suggestion: {
                  type: 'string',
                  description:
                    'Here provide instructions on how the AI should interact conversationally (e.g., Provide a summary of our last interaction. This field is required. Keep suggestions to 30 words or less.)',
                },
                deleteNoteIds: {
                  type: 'array',
                  items: {
                    type: 'string',
                    description:
                      'Include the array of all noteIds you want deleted here. This field is optional.',
                  },
                },
                deleteCategoryIds: {
                  type: 'array',
                  items: {
                    type: 'string',
                    description:
                      'Include the array of all categoryIds you want deleted here. This field is optional.',
                  },
                },
              },
              required: ['suggestion'],
            },
          },
        ],
        prompts: [
          'This is the main prompt...',
          `The main data is {{mainDataKey}}...now do your work`,
        ],
        useWhenValuesPopulated: ['mainDataKey', 'dataKey'],
        voiceId:
          'alloy, or any of these: https://platform.openai.com/docs/guides/text-to-speech/voice-options',
        function_call: { name: 'respond' },
        sentenceBatchSize: 2,
        defaultPostProcessingOld: {
          scenarios: [
            {
              type: 'sizeCheck',
              limit: 10,
              prompt: `Optionally specify a follow-up prompt here, sent in at the time delay in seconds. (For instance: Are there any notes or categories to consolidate or refine to help elucidate these 8 categories more? If so, call the respond function with the appropriate notes or category ids to remove in the deleteCategoryIds or deletetNoteIds parameters, but be sure to also provide replacement notes and categories as necessary. Do not respond at all if there is no need to consolidate.)`,
              delayInSeconds: 20,
            },
          ],
        },
      },
    },
  },
}
export default emptyAIConversation
