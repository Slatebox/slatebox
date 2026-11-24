/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'

import {
  Claims,
  CachedImages,
  CachedImageTiming,
  SlateSnapshots,
  Collaboration,
  Slates,
  SystemSettings,
  VideoHelpGuides,
  LoginLinks,
  ChatIntentions,
  Tags,
} from '../../imports/api/common/models'
import proConTemplate from './proConTemplate.json'
import { templateCategories } from './template-categories.mjs'
import { DEFAULT_AI_FEATURES } from '../methods/ai/feature-config.mjs'

if ((await Claims.find({ _id: 'admin' }).countAsync()) === 0) {
  for (const c of Object.keys(CONSTANTS.claims)) {
    await Claims.insertAsync(CONSTANTS.claims[c])
  }
}

if ((await Collaboration.find().countAsync()) === 0) {
  Collaboration.rawCollection().createIndex({
    slateId: 1,
    dated: 1,
    instanceId: 1,
  })
}

// The old first-visit welcome dialog (its help-icon tour and video) is gone; a database that still
// holds its text drops it here, so nothing can show it again.
await SystemSettings.removeAsync({ _id: 'welcomeMessage' })

await SystemSettings.removeAsync({
  _id: CONSTANTS.systemSettings.youTubeAudioToNotesMessage,
})
if (
  !(await SystemSettings.findOneAsync({
    _id: CONSTANTS.systemSettings.youTubeAudioToNotesMessage,
  }))
) {
  await SystemSettings.insertAsync({
    _id: CONSTANTS.systemSettings.youTubeAudioToNotesMessage,
    title: `Dynamically create notes from YouTube audio.`,
    body: `<p>In order to dynamically create notes from an audio source, you need to do 2 simple things:</p><ol><li><a style='color:#fff;cursor:pointer' href='{{audioUrl}}' download='slatebox_youtube_audio_{{slateId}}.mp3'>Click here to download the YouTube audio mp3.</a> Once saved, start playing it and return to the slate.</li><li>Click the huddle toggle switch to turn on your microphone to listen for external audio. <p><img src='https://files.slatebox.com/sb_huddle_loop.gif'/></p></li></ol><p>As the audio is playing in the background, Slatebox will begin producing notes on a mind-map based on the audio source.<p>If you have any questions click the contact support icon <img src='https://files.slatebox.com/contact_support.png' style='height:25px;'/> in the upper right.</p>`,
  })
}

try {
  LoginLinks.rawCollection().createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 60 * 15, background: true }
  ) // expire in 15 minutes
} catch (err) {
  console.error('Unable to create index on login links', err)
}

if (!(await VideoHelpGuides.findOneAsync())) {
  for (const v of [
    {
      path: '/',
      title: "Welcome to the dashboard! Let's make your first AI slate.",
      id: 'sqoPn7JYfx61tRM8DkCUXa',
    },
    {
      path: '/canvas',
      title: 'Introduction to the node.',
      id: '6zPm2mBFgifiohi2xzZkZF',
    },
  ]) {
    await VideoHelpGuides.insertAsync(v)
  }
  for (const ss of [
    {
      type: CONSTANTS.systemSettings.videoMetaData,
      path: '/',
      title: 'Welcome To Your Dashboard!',
    },
    {
      type: CONSTANTS.systemSettings.videoMetaData,
      path: '/canvas',
      title:
        'Welcome to the Canvas - creating slates is easy, check out these guides!',
    },
  ]) {
    await SystemSettings.insertAsync(ss)
  }
}

// The included amounts for AI and calls (Slatebox Pro, or free before its date) live in SystemSettings 'metering' (server/metering, migration M1).

// await ChatIntentions.removeAsync({})
if (!(await ChatIntentions.findOneAsync())) {
  const intentions = [
    {
      _id: 'adhoc',
      name: 'AdHoc',
      identifier: 'adhoc',
      isAdhoc: true,
      universal: false,
      system: true,
      title:
        'This is an adhoc AI interaction that the system will use if the user initiates an AI interaction without specifying a specific intention',
      details: '',
      gather: {
        items: [
          { key: 'discussion' },
          {
            key: 'idea',
            isPrimary: true,
          },
        ],
        onComplete: 'populateCenterNode',
      },
      ai: {
        decisionTree: {
          inline: {
            engine: {
              upgraded: 'gpt-4o', // 'gpt-4-0613',
              default: 'gpt-3.5-turbo',
            },
            layoutType: {
              val: 'dot',
              overlap: 'compress',
              rankdir: 'TB',
            },
            defaultShapes: {
              category: 'circle',
              note: 'stickyNote',
            },
            autoOpenChat: true,
            errorChecks: [],
            functions: [
              {
                name: 'respond',
                description: 'This is your response to the last query',
                parameters: {
                  type: 'object',
                  properties: {
                    notes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          description: {
                            type: 'string',
                            description: 'What is this note about?',
                          },
                          id: {
                            type: 'string',
                            description:
                              'This is a unique 8 character string that you generate.',
                          },
                          styleNodeId: {
                            type: 'string',
                            description: 'Copy the style from this node.',
                          },
                        },
                        required: ['description', 'id', 'parentCategoryIds'],
                      },
                    },
                    suggestion: {
                      type: 'string',
                      description:
                        'Explain step-by-step why you generated these notes. This field is required. Keep suggestions to 30 words or less.',
                    },
                  },
                  required: ['suggestion'],
                },
              },
            ],
            prompts: [
              "I'd like to create additional notes about a topic I will specify. Pretend you are an expert in the topic provided and your job is to produce as many notes as I specify in my request. Please keep notes to 20 words or less",
              `Here are the details: {{discussion}}`,
            ],
            useWhenValuesPopulated: ['discussion'],
            voiceId: 'alloy',
            function_call: { name: 'respond' },
            sentenceBatchSize: 1,
          },
        },
      },
    },
    {
      _id: 'diagram-code',
      name: 'Diagram Code',
      identifier: 'diagram-code',
      universal: true,
      title: 'Converse about a code snippet and create a diagram.',
      details:
        'Paste in a snippet of code and let Slatebox create a diagram that you can discuss.',
      slateName: 'Code - {{items}}',
      gather: {
        title: "Let's diagram code!",
        message:
          'Please provide a name for the snippet of code you want to diagram as well as the code itself.',
        onComplete: 'populateCenterNode',
        items: [
          {
            placeholder: 'Name this code snippet.',
            key: 'codeSnippetName',
            defaultValue: '',
            type: 'textfield',
            isPrimary: true,
            required: true,
          },
          {
            placeholder:
              'Paste in the code you would like to diagram and discuss. Up to 40k characters.',
            key: 'code',
            type: 'textarea',
            size: 40000,
            required: true,
          },
        ],
        order: 1,
        footerMessage: `Once you start this conversation, the chat will open automatically so you can refine and ask more questions about the diagrammed code. You can also turn on your mic and talk directly to the AI about the code.`,
      },
      ai: {
        decisionTree: {
          inline: {
            engine: {
              upgraded: 'gpt-3.5-turbo', // 'gpt-4-0613',
              default: 'gpt-3.5-turbo',
            },
            layoutType: {
              val: 'dot',
              overlap: 'scalexy',
              rankdir: 'RL',
            },
            defaultShapes: {
              category: 'circle',
              note: 'stickyNote',
            },
            autoOpenChat: true,
            errorChecks: [],
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
                            description:
                              'This is the name of a function or variable.',
                          },
                          id: {
                            type: 'string',
                            description:
                              'This is a unique 8 character string that you generate.',
                          },
                          parentCategoryIds: {
                            type: 'array',
                            items: {
                              type: 'string',
                              description:
                                "What is the functions's parentCategoryIds? You can use 'main' if it is connected to the main topic.",
                            },
                          },
                          isUpdate: {
                            type: 'boolean',
                            description:
                              'Are you updating this category or creating a new one? If updating, set this parameter to true, otherwise false',
                          },
                        },
                        required: [
                          'description',
                          'id',
                          'parentCategoryIds',
                          'isUpdate',
                        ],
                      },
                    },
                    notes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          description: {
                            type: 'string',
                            description:
                              'This is a description of the function or variable.',
                          },
                          id: {
                            type: 'string',
                            description:
                              'This is a unique 8 character string that you generate.',
                          },
                          parentCategoryIds: {
                            type: 'array',
                            items: {
                              type: 'string',
                              description:
                                "What are this notes' parentCategoryIds? You can use 'main' if it is connected to the main topic. If I specify the parentCateogryId in my request, always echo it back exactly as I provided it. If I provided it, then do not remove the note_ or category_ prefixes from the parentCategoryIds in case they exist.",
                            },
                          },
                          isUpdate: {
                            type: 'boolean',
                            description:
                              'Are you updating this note or creating a new one? If updating, set this parameter to true, otherwise false',
                          },
                          styleNodeId: {
                            type: 'string',
                            description: 'Copy the style from this node.',
                          },
                        },
                        required: [
                          'description',
                          'id',
                          'parentCategoryIds',
                          'isUpdate',
                        ],
                      },
                    },
                    suggestion: {
                      type: 'string',
                      description:
                        'What did we last discuss? Summarize as a software engineer. This field is required. Keep suggestions to 30 words or less.',
                    },
                    deleteNoteIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all noteIds you want deleted here. This should only be called if you are consolidating these notes into a different note. This field is optional.',
                      },
                    },
                    deleteCategoryIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all categoryIds you want deleted here. This should only be called if you are consolidating these categories into a different category. This field is optional.',
                      },
                    },
                  },
                  required: ['suggestion'],
                },
              },
            ],
            prompts: [
              "Pretend you are an expert software engineer and we are going to have a conversation about a code snippet. You'll receive a snippet of code that I'd like you to breakdown into all its important parts. Call the respond function with an array of categories and notes objects that describe the processes within this snippet. Categories can represent main ideas and notes represent information about those categories. Reference the specific classes, functions, and variable names in the notes and categories. Attempt to build the categories in order of exection, with a number inside each that represents the order it is executed. If you can't describe a note in 40 words or less, then split those details into multipe notes. Concentrate more on the internal logic of his code snippet and less on any external imports or dependencies. Do not provide any text in markdown format, just use plain text. The first prompt you will receive will be the name of the code snippet being analyzed as well as the code itself. Respond immediately with an array of responses to the respond argument that fully document this snippet. Afterwards, a conversation will ensue about the snippet, so converse with the by providing a suggestion, and optionally add new categories and notes as appropriate or consolidate them. When conversing, do not repeat yourself.",
              `The code snippet is {{codeSnippetName}}. The code to analyze is {{code}}.`,
            ],
            useWhenValuesPopulated: ['codeSnippetName', 'code'],
            voiceId: 'alloy',
            function_call: { name: 'respond' },
            sentenceBatchSize: 1,
            OLDDefaultPostProcessing: {
              OLDscenarios: [
                {
                  type: 'sizeCheck',
                  limit: 10,
                  prompt: `Are there any notes or categories to consolidate or refine to help clarify this code more? If so, call the respond function with the appropriate notes or category ids to remove in the deleteCategoryIds or deletetNoteIds parameters, but be sure to also provide replacement notes and categories as necessary.`,
                  delayInSeconds: 20,
                },
              ],
            },
          },
        },
      },
    },
    {
      _id: 'diagram-to-slate',
      name: 'Diagram To Slate',
      identifier: 'diagram-to-slate',
      universal: true,
      title: '[EARLY ACCESS] Image diagram to editable slate.',
      details:
        'Provide a link to the image, or provide it below. Slatebox will turn it into an editable slate. Note this is an early preview and will not work perfectly.',
      slateName: 'Diagram to Slate',
      gather: {
        title: 'Create a slate from an image of a diagram',
        message:
          "Please either provide a link to the image diagram you'd like to turn into a slate, or upload the diagram below.",
        onComplete: 'populateCenterNode',
        items: [
          {
            placeholder:
              'Please provide a link to the diagram OR upload the diagram below.',
            key: 'imageLink',
            type: 'textfield',
            required: true,
          },
        ],
        order: 1,
        footerMessage: `Once you start this conversation, the chat will open automatically so you can refine and ask more questions about the slate. You can also turn on your mic and talk directly to the AI about the diagram produced.`,
      },
      ai: {
        decisionTree: {
          inline: {
            engine: {
              upgraded: 'gpt-4o', // 'gpt-4-0613', // 'claude-3-opus-20240229', //
              default: 'gpt-4o', // 'claude-3-opus-20240229', //
            },
            layoutType: {
              val: 'none',
            },
            autoOpenChat: true,
            errorChecks: [],
            functions: [
              {
                name: 'respond',
                description:
                  'This is the main and only function to use in your response. The `respond` function has a rich set of parameters that are fully documented in this definition. You do not need to check with me before sending back the results of the `respond` function. You should respond as soon as you are ready with the results.',
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
                            description:
                              'This should represent the text in the category from the original diagram, not any summarized information. Do not describe the shape or details about what this respresent. Again, only provide actual text that was in the original diagram.',
                          },
                          id: {
                            type: 'string',
                            description:
                              'This is a unique 8 character string that you generate.',
                          },
                          noun: {
                            type: 'string',
                            description:
                              'What is the shape of this category? Be as specific as possible, but always use "circle" instead of "oval" if that is the appropriate shape. If a more specific shape is bordered by a circle or rectangle, always provide the more specific shape as the noun. "Circle" and "rectangle" are fallbacks if you cannot be more specific.',
                          },
                          color: {
                            type: 'string',
                            description:
                              'What is the hex color of this category? If transparent, use "transparent" for the color. Otherwise, only assign a hex color that is listed in the initial prompt. Match the color as close as possible to the same color that is in the original diagram for this note. For instance, if this note is green, find the closest green hue in the array of hex colors provided in the initial prompt.',
                          },
                          parentCategoryIds: {
                            type: 'array',
                            items: {
                              type: 'string',
                              description:
                                "What are this category's parentCategoryIds? You can use 'none' if it stands alone.",
                            },
                          },
                          isUpdate: {
                            type: 'boolean',
                            description:
                              'Are you updating this category or creating a new one? If updating, set this parameter to true, otherwise false',
                          },
                          xPos: {
                            type: 'number',
                            description:
                              'What is the x coordinate, in pixels, of this category? Provide the same x coordinate as the category in the original diagram.',
                          },
                          yPos: {
                            type: 'number',
                            description:
                              'What is the y coordinate, in pixels, of this category?  Provide the same y coordinate as the category in the original diagram.',
                          },
                          width: {
                            type: 'number',
                            description:
                              'What is the width, in pixels, of this category? Provide the same width as the category in the original diagram.',
                          },
                          height: {
                            type: 'number',
                            description:
                              'What is the height, in pixels, of this category?  Provide the same height as the category in the original diagram.',
                          },
                          textLines: {
                            type: 'number',
                            description:
                              'How many new lines are in this text block?',
                          },
                        },
                        required: [
                          'description',
                          'id',
                          'parentCategoryIds',
                          'noun',
                          'color',
                          'isUpdate',
                          'xPos',
                          'yPos',
                          'width',
                          'height',
                          'textLines',
                        ],
                      },
                    },
                    notes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          description: {
                            type: 'string',
                            description:
                              'This should represent the text in the note from the original diagram, not any summarized information. Do not describe the shape or details about what this respresent. Again, only provide actual text that was in the original diagram.',
                          },
                          id: {
                            type: 'string',
                            description:
                              'This is a unique 8 character string that you generate.',
                          },
                          noun: {
                            type: 'string',
                            description:
                              'What is the shape of this note? Be as specific as possible, but always use "circle" instead of "oval" if that is the appropriate shape. If a more specific shape is bordered by a circle or rectangle, always provide the more specific shape as the noun. "Circle" and "rectangle" are fallbacks if you cannot be more specific.',
                          },
                          color: {
                            type: 'string',
                            description:
                              'What is the hex color of this node? If transparent, use "transparent" for the color. Otherwise, only assign a hex color that is listed in the initial prompt. Match the color as close as possible to the same color that is in the original diagram for this note. For instance, if this note is green, find the closest green hue in the array of hex colors provided in the initial prompt.',
                          },
                          parentCategoryIds: {
                            type: 'array',
                            items: {
                              type: 'string',
                              description:
                                "What are these notes' parentCategoryIds? You can use 'none' if it stands alone.",
                            },
                          },
                          isUpdate: {
                            type: 'boolean',
                            description:
                              'Are you updating this note or creating a new one? If updating, set this parameter to true, otherwise false',
                          },
                          xPos: {
                            type: 'number',
                            description:
                              'What is the x coordinate, in pixels, of this note? Provide the same x coordinate as the note in the original diagram.',
                          },
                          yPos: {
                            type: 'number',
                            description:
                              'What is the y coordinate, in pixels, of this note?  Provide the same y coordinate as the note in the original diagram.',
                          },
                          width: {
                            type: 'number',
                            description:
                              'What is the width, in pixels, of this note? Provide the same width as the note in the original diagram.',
                          },
                          height: {
                            type: 'number',
                            description:
                              'What is the height, in pixels, of this note?  Provide the same height as the note in the original diagram.',
                          },
                          textLines: {
                            type: 'number',
                            description:
                              'How many new lines are in this text block?',
                          },
                        },
                        required: [
                          'description',
                          'id',
                          'parentCategoryIds',
                          'noun',
                          'color',
                          'isUpdate',
                          'xPos',
                          'yPos',
                          'width',
                          'height',
                          'textLines',
                        ],
                      },
                    },
                    suggestion: {
                      type: 'string',
                      description:
                        'What did we last discuss? Summarize the image to slate conversion. This field is required. Keep suggestions to 30 words or less.',
                    },
                    deleteNoteIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all noteIds you want deleted here. In our conversation, if I ask for the diagram to be refined or redone, delete any affected noteIds here. This field is optional.',
                      },
                    },
                    deleteCategoryIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all categoryIds you want deleted here. In our conversation, if I ask for the diagram to be refined or redone, delete any affected categoryIds here. This field is optional.',
                      },
                    },
                  },
                  required: ['suggestion'],
                },
              },
            ],
            prompts: [
              "Carefully analyze the provided diagram to identify and catalog every individual component. For each component, you must determine its exact x,y coordinates, width, and height as displayed in the image, to understand its placement and scale. Create an array of JSON objects, with each object representing a 'category' (main idea) or a 'note' (sub-idea) as they appear in the diagram. Use the lines and arrows between components, as well as any text, to understand the parent-child relationships, reflected as parentCategoryIds in the JSON. It's possible for a given node to have multiple parentCategoryIds depending on how the lines and arrows point between the components, so pay careful attention to all the relationships to provide an accurate representation of all the relationships. Guidelines: (1) Transcribe the x,y coordinates and dimensions (width and height) precisely from their actual positions in the diagram without inferring or adjusting based on perceived hierarchy. (2) Any standalone text that appears as a label on top of a line should be considered a separate component with no parentCategoryIds and represented as a rectangle. (3) For each component, provide the text content, x,y coordinates, width, height, and parentCategoryIds. (4) Include components that may not have any parentCategoryIds or connections if they exist. In your initial response, provide: (1)  The total count of components. (2) An explanation for this count. (3) Be ready for further instructions to refine or correct the JSON array, accurately reflecting the diagram's structure without summary or adjustment of the original coordinates. {{imageColors}}",
              `{{imageLink}}`,
            ],
            oldPrompt:
              "Pretend you are an engineer who is going to recreate this diagram as an array of JSON objects. Please closely analyze this diagram image to locate every individual component and its placement. Think step-by-step about the width, height, x, and y coordinates of every component in this diagram so you can understand how the different components are related and how the heiarchy of information is presented. Once analyzed, you will come up with a discrete number of 'notes' and 'categories' that are represented in this diagram. A 'category' is a main idea, and a 'note' is a sub-idea. This is not a summary of the diagram, but rather a direct recreation of every component in this diagram represented as an array of JSON objects. When compiled, call the `respond` function with the results. The length of the array that you are sending should match the discrete number of components that you counted during the initial analysis. Every component in the diagram needs to be represented in the array. If you are not able to effectively break this diagram down into all its parts, you can simply respond with just a `suggestion` that explains why it is not feasible. But if you can, remember do not summarize or consolidate information. The categories represent the main components in the diagram, and the notes represent components that are sub ideas to these categories. Do not create any categories or notes that do not directly represent an component within this image. All components within the image EXCEPT any arrows should be included as a note or category. However, when arrows are present, use them to determine the correct parent child relationships between the categories and notes, assigning the parentCategoryIds accordingly. For example, if component A has an arrow pointing to component B, then component B's parentCategoryIds would include a reference to component A. Pay extremely careful attention to where the arrows are pointing so you can appropriately assign the parentCategoryIds. If an arrow has any text near it or over it, then treat that as an independent, detatched note, but do not attach any parentCategoryIds, and simply use 'rectangle' as its noun. {{imageColors}} Once you respond, a conversation may ensue about the image, so include a suggestion that provides the discrete number discussed earlier on how many notes and categories exist in this diagram, and a brief one-sentence explanation of how you came to this conclusion. After you've generated the array, we can have a conversation about the work. I may ask you to refine the diagram or redo it, so be prepared to delete any notes or categories that are no longer relevant. Think step-by-step about what notes and categories should be deleted during our conversation and always ensure to delete the appropriate amount. Remember to mark the isUpdate as true if you need to adjust any of the properties of an existing note or category. The only time you isUpdate should be false is if you're creating the note or category for the first time. If you delete any notes or categories, then recreate them, then isUpdate should be false.",
            isVision: true,
            removeExistingNodes: true,
            useWhenValuesPopulated: ['imageName', 'imageLink'],
            voiceId: 'alloy',
            function_call: { name: 'respond' },
            sentenceBatchSize: 1,
            OLDDefaultPostProcessing: {
              OLDscenarios: [
                {
                  type: 'sizeCheck',
                  limit: 10,
                  prompt: `Are there any notes or categories to consolidate or refine to help clarify this code more? If so, call the respond function with the appropriate notes or category ids to remove in the deleteCategoryIds or deletetNoteIds parameters, but be sure to also provide replacement notes and categories as necessary.`,
                  delayInSeconds: 20,
                },
              ],
            },
          },
        },
      },
    },
    {
      _id: 'explorer',
      name: 'Explore',
      identifier: 'explore',
      universal: true,
      title: 'Talk about anything!',
      details:
        'Have an open-ended discussion about any topic and build a diagram.',
      slateName: '{{items}}',
      gather: {
        title: "Let's chat!",
        message: 'What is this idea about?',
        onComplete: 'populateCenterNode',
        items: [
          {
            placeholder: "I'd like to chat about...",
            key: 'idea',
            defaultValue: '',
            type: 'textfield',
            isPrimary: true,
            required: true,
          },
          {
            placeholder: 'While collaborating, act as a ...',
            key: 'persona',
            defaultValue: '',
            type: 'select',
            possibleValues: [
              {
                text: 'Expert',
                val: 'expert',
                teaser: `Let's brainstrom a topic together.`,
                supplemental:
                  "Pretend you are an expert in the topic I choose and we are brainstorming together. Use your exhaustive knowledge to answer questions I have and flesh out the topic. Think step-by-step about where the information comes from prior to providing it. Be as specific as possible, and strive for interesting perspectives on every aspect -- let's create truly original work together! Make sure to always provide the 'echoNodeId' parameter back to me whenever I provide it.",
                welcomeMessage: {
                  title:
                    "Hey there, I'm an expert visual AI -- let's start brainstorming!",
                  description:
                    '<p>I will dig in on this idea with you: "{{idea}}."</p><p>Turn on the huddle toggle switch so I can hear you!</p><p><img src=\'https://files.slatebox.com/sb_huddle_loop.gif\'/></p>If you prefer typing to chatting, use the chat box to message me!</p>',
                },
                additionalParams: [
                  {
                    deleteNoteIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all noteIds that I have asked you to remove here. This field is optional and should only be sent when I ask for notes to be deleted, but you can suggest that we delete some if you feel it appropriate.',
                      },
                    },
                  },
                  {
                    deleteCategoryIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all categoryIds that I have asked you to remove here. This field is optional and should only be sent when I ask for categories to be deleted, but you can suggest that we delete some if you feel it appropriate.',
                      },
                    },
                  },
                  {
                    suggestion: {
                      type: 'string',
                      description:
                        'Always include a suggestion with every response that briefly highlights what was just added. Keep these suggestions to 10 words or less.',
                    },
                    required: ['suggestion'],
                  },
                ],
                postProcessing: { scenarios: [] },
                sentenceBatchSize: 1,
                voiceId: 'alloy',
                additionalErrorChecks: [],
                // layoutType: {
                //   val: 'dot',
                //   overlap: 'scalexy',
                //   rankdir: 'LR',
                // },
                layoutType: {
                  val: 'dot',
                  overlap: 'compress',
                  rankdir: 'TB',
                },
                defaultShapes: {
                  category: 'circle',
                  note: 'stickyNote',
                },
              },
              {
                text: 'Legal Advisor',
                val: 'legal-advisor',
                teaser: `Provide legal advice`,
                supplemental: `I am a real person, so don't make anything up. Pretend you are my legal expert and we are going to have a conversation around this legal topic that I need help understanding. If it would be helpful to diagram any part of our discussion with a visual aid, use the notes and categories to explain. Only use notes and categories if it is helpful for the explanation, but always respond with a suggestion that explains step-by-step why you're providing this legal advice. If you are updating an existing note or category, make sure the isUpdate parameter is set to true. I may provide you with a document that we can discuss together, or I may just have questions and need you to respond to them.`,
                layoutType: {
                  val: 'twopi',
                  overlap: 'scalexy',
                },
                welcomeMessage: {
                  title: "I'm your legal advisor who likes to diagram.",
                  description:
                    "<p>Let's explore your loegal question: {{idea}}</p><p>Turn on the huddle toggle switch so I can hear you!</p><p><img src='https://files.slatebox.com/sb_huddle_loop.gif'/></p>If you prefer typing to chatting, use the chat box to message me!</p>",
                },
                postProcessing: {
                  scenarios: [
                    {
                      type: 'missing',
                      params: ['suggestion'],
                      prompt: `You didn't provide a suggestion last time - remember to always provide a suggestion to summarize and explain your thoughts to me.`,
                      delayInSeconds: 5,
                    },
                  ],
                },
                additionalCaptureItems: [
                  {
                    placeholder:
                      'Optional legal text / document that you want to discuss',
                    key: 'legalText',
                    defaultValue: '',
                    type: 'textarea',
                    isPrimary: false,
                    required: false,
                    additionalPrompts: [
                      `Here is the legal document text: {{legalText}}`,
                    ],
                  },
                ],
                additionalParams: [
                  {
                    suggestion: {
                      type: 'string',
                      description:
                        "Always include a suggestion in every response to me. With this, you can summarize how you feel about our last interaction or provide legal advice on how to better understand what you're saying. Keep suggestions to 30 words or less.",
                    },
                    required: ['suggestion'],
                  },
                  {
                    deleteNoteIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all noteIds you want deleted here. Only delete these notes if you are consolidating their information in a new note. This field is optional.',
                      },
                    },
                  },
                  {
                    deleteCategoryIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all categoryIds you want deleted here. Only delete these categories if you are consolidating their information in a new category. This field is optional.',
                      },
                    },
                  },
                ],
                sentenceBatchSize: 1,
                defaultShapes: {
                  category: 'circle',
                  note: 'stickyNote',
                },
                voiceId: 'alloy',
                additionalErrorChecks: [],
              },
              {
                text: 'Scribe',
                val: 'scribe',
                teaser: `I'll create the diagram that you dictate. You can ask for more, but I won't preempively collaborate.`,
                supplemental:
                  "Your job is to simply create whatever note or category I ask of you. You need to always generate the unique ids needed for either the note or category, but you never need to suggest or add any additional information unless I explicitly ask you to. If I ask you a question or want to converse with you, but do not explicitly ask you to create a note or category, then respond with a suggestion, but do not create a category or note unless I explicitly ask. I will let you know what categories the notes belong into. Just listen and create the categories and notes that I say. If I ask you to create a note or category as a specific noun (e.g., create a note as an apple) then provide the noun I ask for in the 'noun' parameter of the note or category object in the response. Do not self-reference in either note or category that they are notes or categories (e.g., don't use the word 'note' or 'category' in either description). If you are updating an existing note or category, make sure the isUpdate parameter is set to true. Do not remove anything unless I ask you to. If you do not have enough information, call the respond function with waiting set to true. Provide as many categories and notes in the response array that are relevant based on what I am asking.",
                welcomeMessage: {
                  title:
                    "I'm your scribe. I'll diagram whatever you ask of me.",
                  description:
                    "<p>I'll  build out a diagram about \"{{idea}}\" per your direction.</p><p>Turn on the huddle toggle switch so I can hear you!</p><p><img src='https://files.slatebox.com/sb_huddle_loop.gif'/></p>If you prefer typing to chatting, use the chat box to message me!</p>",
                },
                additionalParams: [
                  {
                    background: {
                      type: 'object',
                      properties: {
                        isReferencingOnlyUserContent: {
                          type: 'boolean',
                          description:
                            'Explain why this node or category is referencing only user content and not content you provided. This should always be true unless the user asks you to provide additional context. If you provided additional context, set to false.',
                        },
                        explain: {
                          type: 'string',
                          description:
                            'When isReferencingOnlyUserContent is false, explain why you provided this additional user content.',
                        },
                      },
                    },
                    required: ['background'],
                  },
                  {
                    deleteNoteIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all noteIds that I have asked you to remove here. This field is optional and should only be sent when I ask for notes to be deleted',
                      },
                    },
                  },
                  {
                    deleteCategoryIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all categoryIds that I have asked you to remove here. This field is optional and should only be sent when I ask for categories to be deleted',
                      },
                    },
                  },
                  {
                    suggestion: {
                      type: 'string',
                      description:
                        "Do you have something to say? Typically you shouldn't but if you need to clarify something, use this param to ask. Keep suggestions to 30 words or less.",
                    },
                  },
                ],
                postProcessing: {
                  scenarios: [
                    {
                      type: 'whenTrue',
                      params: ['background.isReferencingOnlyUserContent'],
                      prompt: `You set isReferencingOnlyUserContent and indicated that you're providing additional infromation that the user did not provide. If this is correct, and the user expiclitly asked for the data, then you do not need to do anything. If you provided this infromation and the user did not ask for it, however, then respond by deleting it with the appropriate deleteNoteIds or deleteCategoryIds param.`,
                      delayInSeconds: 1,
                    },
                  ],
                },
                sentenceBatchSize: 1,
                voiceId: 'alloy',
                additionalErrorChecks: [],
                layoutType: {
                  val: 'none',
                  overlap: 'scalexy',
                },
              },
              {
                text: 'Note-Taker',
                val: 'note-taker',
                teaser: `Listen in and produce notes as a mind map`,
                supplemental:
                  "You will be listening in on a conversation about this topic that needs to be categorized. Do not reply with any information immediately, but rather wait until you start getting responses before providing any notes or categories. You may already know about the topic, but do not offer up information. Use only the user-supplied information, not your own background information, to build out categories and notes. As you synthesize the information into categories and notes, invoke the respond function to deliver the array of categories and notes. Either create a new category or use an existing category when creating a note. Every note must belong to a category. Categories should be nested as appropriate -- be specific as you create categories, and do not simply put all notes under the same category. At the most, there should be 5 notes per category. As you create the notes, think step-by-step about what category it should go under.  If you think a given category is strongly associated with a specific noun, then provide that in the 'noun' parameter inside the category object. Always provide simply 'rectangle' as the noun for every note object.",
                postProcessing: {
                  scenarios: [
                    {
                      type: 'whenTrue',
                      params: ['background.isReferencingOnlyUserContent'],
                      prompt: `You set isReferencingOnlyUserContent and indicated that you're providing additional infromation that the user did not provide. If this is correct, and the user expiclitly asked for the data, then you do not need to do anything. If you provided this infromation and the user did not ask for it, however, then respond by deleting it with the appropriate deleteNoteIds or deleteCategoryIds param.`,
                      delayInSeconds: 1,
                    },
                  ],
                },
                welcomeMessage: {
                  title:
                    "I'm a note-taker. Let me listen in to your conversation so I can diagram it.",
                  description:
                    "<p>First, turn on the huddle toggle switch so I can hear the audio!</p><p><img src='https://files.slatebox.com/sb_huddle_loop.gif'/></p>I'll build a diagram of notes from <a style='color:#fff' href='{{idea}}' target='_blank'>the audio source</a>.<div style='border: 1px dotted #ccc; margin: 6px; padding: 6px;background-color:#333;color:#fff;'><b>Important Note:</b> I cannot hear audio played from the SAME browser as this one. So either use a different browser (Safari, etc) or play the audio content from your phone -- that way I can hear it and create the diagram.</div>",
                },
                sentenceBatchSize: 2,
                defaultShapes: {
                  category: 'circle',
                  note: 'stickyNote',
                },
                voiceId: 'alloy',
                additionalParams: [],
                additionalErrorChecks: [
                  {
                    type: 'noteWordCount',
                    limit: 75,
                  },
                ],
              },
              {
                text: 'Storyteller',
                val: 'storyteller',
                teaser: `Let's tell a story together! This is a "yes...and" collaboration!`,
                supplemental:
                  "As a storyteller, you and I will captivate our audience with an engaging narrative. This is not meant to be a real topic. We are exploring a fictional idea together, so do not fact-check or assess whether or not the topic being discussed is real. It is not real. Never remove notes or categories without my approval. Always get my approval before adding a node or category, so always respond with a suggestion so we can think through adding new ideas together. Your job is ask probing questions, listen, and then if I agree, add notes and categories for the story. So let's work together to outline a fictional story that resonates emotionally and stimulates imagination. Don't police the morals, or worry if it gets too negative. This is about expression and exploration, not censorship. Pay attention to pacing, tone, and how an audience will react. Use categories typical to novels and scripts that are important to storytelling to group the notes together. Most notes should be connected to a category and not directly connected to the main topic. If you think a given category is strongly associated with a specific noun, then provide that in the 'noun' parameter inside the category object. You are an active participant in generating this story, so don't repeat what I'm saying. Challenge me if the ideas are weak so we can create a stronger story together. Let's keep the word count on the notes to 50 or less. Categories should be between 1-5 words only.",
                welcomeMessage: {
                  title: "Let's tell a story!",
                  description:
                    "<p>Let's build out a story about \"{{idea}}\" as collaborators.</p><p>Turn on the huddle toggle switch so I can hear you!</p><p><img src='https://files.slatebox.com/sb_huddle_loop.gif'/></p>If you prefer typing to chatting, use the chat box to message me!</p>",
                },
                postProcessing: {
                  scenarios: [
                    {
                      type: 'missing',
                      params: ['suggestion'],
                      prompt: `What are we missing? What can give the story more originality? Let's think outside the box.`,
                      delayInSeconds: 20,
                    },
                    {
                      type: 'sizeCheck',
                      limit: 10,
                      prompt: `Do you have ways to tighten the narrative? Only provide a suggestion if you have specific notes and categories in mind that are less relevant to the story. Do not remove any note or category until first asking me if we should remove them. If I respond yes, then you can remove them using the deleteCategoryIds and deleteNoteIds parameters. When deleting, please remember to include ALL the relevent ids of the notes and categories in the deleteNoteIds or deleteCategoryIds parameters and not just one id. You don't need to read the descriptions of the notes and categories that you've deleted. Just tell me how many you removed.`,
                      delayInSeconds: 20,
                    },
                  ],
                },
                sentenceBatchSize: 1,
                defaultShapes: {
                  category: 'circle',
                  note: 'stickyNote',
                },
                voiceId: 'onyx',
                additionalErrorChecks: [
                  {
                    type: 'noteWordCount',
                    limit: 50,
                  },
                ],
                additionalParams: [
                  {
                    suggestion: {
                      type: 'string',
                      description:
                        'Always include a suggestion in every response to me. With this, you can summarize how you feel about our last interaction or make suggestions on how we can make this a more yes-and collaboration! Keep suggestions to 30 words or less.',
                    },
                    required: ['suggestion'],
                  },
                  {
                    deleteNoteIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all noteIds that I have confirmed you can remove here. If I have not confirmed that these notes can be deleted, then ask me first and do not include their ids here.',
                      },
                    },
                  },
                  {
                    deleteCategoryIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description:
                          'Include the array of all categoryIds that I have confirmed you can remove here. If I have not confirmed that these categories can be deleted, then ask me first and do not include their ids here.',
                      },
                    },
                  },
                ],
              },
            ],
            isPrimary: false,
            required: false,
          },
        ],
        order: 1,
        footerMessage: `Once you start this conversation, the chat will open automatically so you can refine and ask more questions about the idea. Ask anything! You can also turn on your mic and chat away.`,
      },
      ai: {
        decisionTree: {
          inline: {
            engine: {
              upgraded: 'gpt-4o', // 'gpt-3.5-turbo', // 'gpt-4o', // 'gpt-4-0613',
              default: 'gpt-3.5-turbo',
            },
            layoutType: {
              val: 'neato',
              overlap: 'scalexy',
            },
            rootProperty: 'responses',
            autoOpenChat: true,
            errorChecks: [
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
                            description:
                              'This is the category name. This field is required.',
                          },
                          id: {
                            type: 'string',
                            description:
                              'This is a UNIQUE 8 character string that you generate. This field is required.',
                          },
                          noun: {
                            type: 'string',
                            description:
                              'Is there a specific noun that best describes this category? If so, provide it. Otherwise just use the default "rectangle".',
                          },
                          parentCategoryIds: {
                            type: 'array',
                            items: {
                              type: 'string',
                              description:
                                "What is this category's parentCategoryIds? You can use 'main' if it is connected to the main topic.",
                            },
                          },
                          isUpdate: {
                            type: 'boolean',
                            description:
                              'Are you updating this category or creating a new one? If updating, set this parameter to true, otherwise false',
                          },
                        },
                        required: [
                          'description',
                          'id',
                          'noun',
                          'parentCategoryIds',
                          'isUpdate',
                        ],
                      },
                    },
                    notes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          description: {
                            type: 'string',
                            description: 'This is a description of the idea.',
                          },
                          id: {
                            type: 'string',
                            description:
                              'This is a UNIQUE 8 character string that you generate.',
                          },
                          noun: {
                            type: 'string',
                            description:
                              'Is there a specific noun that best describes this note? If so, provide it. Otherwise just use the default "rectangle".',
                          },
                          parentCategoryIds: {
                            type: 'array',
                            items: {
                              type: 'string',
                              description:
                                "What is this notes's parentCategoryIds? You can use 'main' if it is connected to the main topic.",
                            },
                          },
                          isUpdate: {
                            type: 'boolean',
                            description:
                              'Are you updating this note or creating a new one? If updating, set this parameter to true, otherwise false',
                          },
                          styleNodeId: {
                            type: 'string',
                            description: 'Copy the style from this node.',
                          },
                        },
                        required: [
                          'description',
                          'id',
                          'noun',
                          'parentCategoryIds',
                          'isUpdate',
                        ],
                      },
                    },
                  },
                  required: [],
                },
              },
            ],
            defaultPostProcessing: {
              scenarios: [
                // {
                //   type: 'missing',
                //   params: ['suggestion'],
                //   prompt: `Any suggestions to further focus the conversation? Just state the suggestion only.`,
                //   delayInSeconds: 20,
                // },
                {
                  type: 'sizeCheck',
                  limit: 10,
                  prompt: `Are there any notes or categories to consolidate or refine? Any notes or categories to remove? If so, call the respond function with the appropriate notes or category ids to remove, but be sure to also provide replacement notes and categories as necessary.`,
                  delayInSeconds: 20,
                },
              ],
            },
            prompts: [
              'I\'d like to chat about "{{idea}}" and you are my {{persona}}. {{persona_supplemental}} It is extremely important that all notes and category ids have unique ids. Use random 8 character strings to ensure uniqueness. There should be no duplicate category or note ids. You do not need to acknowledge or repeat my instructions.',
            ],
            useWhenValuesPopulated: ['note'],
            function_call: { name: 'respond' },
          },
        },
      },
    },
  ]
  for (const intent of intentions) {
    await ChatIntentions.insertAsync(intent)
  }
}

// Seed-data hygiene (iter57, idempotent): the legacy-imported intentions
// still pin retired Anthropic models (claude-3-5-* are dead keys) and carry
// raw display placeholders. Feature config wins for provider routing, but
// sweep anyway so no path can consume a dead engine name. Only display
// strings are token-cleaned — decisionTree prompt templates keep their
// resolvable {{key}} tokens (those fill from gather values at assembly).
try {
  for (const doc of await ChatIntentions.find({}).fetchAsync()) {
    const engine = doc?.ai?.decisionTree?.inline?.engine
    if (typeof engine?.default !== 'string') continue
    const hasDeadEngine = /claude-3-5/.test(engine.default + (engine.upgraded || ''))
    // Nothing reads 'upgraded' any more: the server picks the model. Keep no paid-only model in the data.
    const holdsOtherModel = engine.upgraded !== undefined && engine.upgraded !== engine.default
    if (!hasDeadEngine && !holdsOtherModel) continue
    // a dead model is repinned to the generation default (server/config/ai-defaults.json)
    const model = /claude-3-5/.test(engine.default) ? DEFAULT_AI_FEATURES.generation.engine : engine.default
    await ChatIntentions.updateAsync(
      { _id: doc._id },
      { $set: { 'ai.decisionTree.inline.engine': { default: model, upgraded: model } } },
    )
    console.log('seed-hygiene: repinned dead engine on intention', doc._id)
  }
} catch (err) {
  console.warn('seed-hygiene sweep failed (non-fatal)', err?.message)
}

// temporary for all slates
// let c = 0;
// for (let s of Slates.find({}).fetchAsync()) {
//   c++;
//   console.log("updating slate", s._id, c);
//   if (s.options.name && s.options.name.trim() !== "") {
//     await Slates.updateAsync({ _id: s._id }, { $set: {
//       "options.searchName": createEdgeNGrams(s.options.name),
//       "options.searchDescription": createEdgeNGrams(s.options.description),
//       "options.searchText": s.nodes && s.nodes.length > 0 ? createEdgeNGrams(s.nodes.map(n => n.options.text).join(" ")) : ""
//     }});
//   }
// }

// if (Slates.find().countAsync() === 0) {
//   // {
// 	// 	"v" : 2,
// 	// 	"key" : {
// 	// 		"_fts" : "text",
// 	// 		"_ftsx" : 1
// 	// 	},
// 	// 	"name" : "options.name_text_options.description_text_nodes.options.text_text",
// 	// 	"weights" : {
// 	// 		"nodes.options.text" : 1,
// 	// 		"options.description" : 1,
// 	// 		"options.name" : 1
// 	// 	},
// 	// 	"default_language" : "english",
// 	// 	"language_override" : "language",
// 	// 	"ns" : "slatebox.slates",
// 	// 	"textIndexVersion" : 3
// 	// },
// }

// Curated starter template: Pro/Con Analysis. The welcome assistant only
// advertises the template catalog when it is NON-empty (see
// welcome-template-routing); seeding one approved template re-arms the full
// template product: expandTemplates lists it, previewTemplate + load flow
// render it, and the populate kick carries real category content.
const proCon = await Slates.findOneAsync({ shareId: proConTemplate.shareId })
if (!proCon) {
  await Slates.insertAsync(proConTemplate)
} else if (
  proCon.options?.templatePrompt !== proConTemplate.options.templatePrompt
) {
  // Seed JSON is the SOURCE OF TRUTH for the shipped template's kickoff
  // text. Without this sync the first-seeded DB copy froze forever (the
  // live docs carried the pre-rewrite prompt on both test and prod until
  // iter24). Scope is pinned to the single master template doc — user
  // canvas copies of templatePrompt are never touched.
  await Slates.updateAsync(
    { shareId: proConTemplate.shareId, 'options.isTemplate': true },
    {
      $set: {
        'options.templatePrompt': proConTemplate.options.templatePrompt,
      },
    }
  )
}

if ((await CachedImages.find().countAsync()) === 0) {
  CachedImages.rawCollection().createIndex({ url: 1, created: 1 })
  CachedImageTiming.rawCollection().createIndex({
    provider: 1,
    filter: 1,
    lastSearched: 1,
  })
  // CachedImages.rawCollection().createIndex( { created: 1 }, { expireAfterSeconds: 60 * 60 * 24 } );
}

if ((await SlateSnapshots.find().countAsync()) === 0) {
  SlateSnapshots.rawCollection().createIndex({
    slateId: 1,
    userId: 1,
    created: 1,
  })
  SlateSnapshots.rawCollection().createIndex(
    { created: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 3 }
  ) // 3 rolling days of snapshots for every slate
}

if (!(await Tags.findOneAsync())) {
  Tags.rawCollection().insertMany(templateCategories)
}
