// The kinds of slate the welcome flow can make ("Create with the agent"), as the agent picks them
// with setIntention. Each kind carries its gather items, prompts, respond schema and layout, read by
// initAIConversation on the client. Moved verbatim from the shared chatIntentions records production
// served on 2026-11-24 (the scenarios editor is gone; the collection is no longer read). The model
// is not here: the server picks it (the part's model in Admin → AI control).
/* eslint-disable */
export default [
  {
    "_id": "scribe",
    "name": "Scribe",
    "details": "Direct me to create specific diagram elements and I'll build them exactly as specified",
    "slateName": "Scribe Session",
    "gather": {
      "title": "What would you like me to diagram?",
      "message": "I'll create whatever notes and categories you specify",
      "onComplete": "populateCenterNode",
      "items": [
        {
          "placeholder": "I'd like to create a diagram about...",
          "key": "idea",
          "defaultValue": "",
          "type": "textfield",
          "isPrimary": true,
          "required": true
        }
      ],
      "order": 1,
      "footerMessage": "Once you start this conversation, the chat will open automatically. Tell me exactly what notes and categories to create. You can also turn on your mic and speak your requests!"
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "layoutType": {
            "val": "none",
            "overlap": "scalexy"
          },
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is your response to create exactly what was requested",
              "parameters": {
                "type": "object",
                "properties": {
                  "categories": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "This is the category name. This field is required."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a UNIQUE 8 character string that you generate. This field is required."
                        },
                        "noun": {
                          "type": "string",
                          "description": "Is there a specific noun that best describes this category? If so, provide it. Otherwise just use the default \"rectangle\"."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "description": "What is this category's parentCategoryIds? You can use 'main' if it is connected to the main topic."
                          }
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Are you updating this category or creating a new one? If updating, set this parameter to true, otherwise false"
                        }
                      },
                      "required": [
                        "description",
                        "id",
                        "noun",
                        "parentCategoryIds",
                        "isUpdate"
                      ]
                    }
                  },
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "This is exactly what was dictated for the note content."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a UNIQUE 8 character string that you generate."
                        },
                        "noun": {
                          "type": "string",
                          "description": "The specific noun requested, or \"rectangle\" if none specified."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "description": "What is this notes's parentCategoryIds? You can use 'main' if it is connected to the main topic."
                          }
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Are you updating this note or creating a new one? If updating, set this parameter to true, otherwise false"
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "This is the entire <svg>...</svg> string that makes up the visualization being requested. Users can ask for special visualizations to be produced (infographics, flowcharts, etc) or perhaps a specific kind of group activity where users can put virtual sticky notes. In either case, be creative and highly specific when producing these visualizations. Whatever is asked for, these visualizations or collaborative exercises need to be highly specific to the context being analyzed. Prior to building the svg, make a plan on how you think it should look to ensure beautiful design, no text overlap, and clarity for the audience and stakeholders you are working with. Always ensure the background of the SVG is white. Be specific in building the SVG visualization with details from the context."
                            },
                            "stickyNotesToCreate": {
                              "type": "number",
                              "description": "How many sticky notes should be created?"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this template in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this template in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "stickyNotesToCreate",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "description",
                        "id",
                        "noun",
                        "parentCategoryIds",
                        "isUpdate"
                      ]
                    }
                  },
                  "background": {
                    "type": "object",
                    "properties": {
                      "isReferencingOnlyUserContent": {
                        "type": "boolean",
                        "description": "Explain why this node or category is referencing only user content and not content you provided. This should always be true unless the user asks you to provide additional context. If you provided additional context, set to false."
                      },
                      "explain": {
                        "type": "string",
                        "description": "When isReferencingOnlyUserContent is false, explain why you provided this additional user content."
                      }
                    },
                    "required": [
                      "isReferencingOnlyUserContent"
                    ]
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Do you have something to say? Typically you shouldn't but if you need to clarify something, use this param to ask. Keep suggestions to 30 words or less."
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "Include the array of all noteIds that were requested to be removed. Only include if explicitly asked to delete."
                    }
                  },
                  "deleteCategoryIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "Include the array of all categoryIds that were requested to be removed. Only include if explicitly asked to delete."
                    }
                  }
                },
                "required": [
                  "background"
                ]
              }
            }
          ],
          "prompts": [
            "Your job is to simply create whatever note or category I ask of you about: {{idea}}. {{instructions}} You need to always generate the unique ids needed for either the note or category, but you never need to suggest or add any additional information unless I explicitly ask you to. If I ask you a question or want to converse with you, but do not explicitly ask you to create a note or category, then respond with a suggestion, but do not create a category or note unless I explicitly ask. I will let you know what categories the notes belong into. Just listen and create the categories and notes that I say. If I ask you to create a note or category as a specific noun (e.g., create a note as an apple) then provide the noun I ask for in the 'noun' parameter of the note or category object in the response. Do not self-reference in either note or category that they are notes or categories (e.g., don't use the word 'note' or 'category' in either description). If you are updating an existing note or category, make sure the isUpdate parameter is set to true. Do not remove anything unless I ask you to. If you do not have enough information, call the respond function with waiting set to true. {{technicalInstructions}}"
          ],
          "defaultTechnicalInstructions": "Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "defaultShapes": {
            "category": "circle",
            "note": "stickyNote"
          },
          "sentenceBatchSize": 1,
          "voiceId": "alloy",
          "postProcessing": {
            "scenarios": [
              {
                "type": "whenTrue",
                "params": [
                  "background.isReferencingOnlyUserContent"
                ],
                "prompt": "You set isReferencingOnlyUserContent and indicated that you're providing additional information that the user did not provide. If this is correct, and the user explicitly asked for the data, then you do not need to do anything. If you provided this information and the user did not ask for it, however, then respond by deleting it with the appropriate deleteNoteIds or deleteCategoryIds param.",
                "delayInSeconds": 1
              }
            ]
          },
          "function_call": {
            "name": "respond"
          }
        }
      }
    }
  },
  {
    "_id": "traditional-slide-deck-presentation",
    "name": "Traditional Slide Deck Presentation",
    "details": "Transform your data into structured, professional slide decks with clear narrative flow. Perfect for formal business presentations, pitch decks, financial reports, and any scenario requiring a classic slide-by-slide format. NOTE that a pitch deck, marketing materials, or other presentation does not have to fit this traditional slide deck presentation. Prior to choosing this intention, ensure that the user wants to build a traditional slides-based presentation. A dynamic presentation will be more creative and offer more interesting visuals. This presentation maintains a traditional structure.",
    "slateName": "{{items}}",
    "gather": {
      "title": "Create your slide deck presentation.",
      "message": "What story do you want to tell?",
      "onComplete": "",
      "items": [
        {
          "placeholder": "Describe the content for your slide deck. Include any specific requirements or references to include. You can upload supporting documents using the paperclip icon.",
          "key": "idea",
          "required": true,
          "isPrimary": true
        }
      ],
      "order": 1,
      "footerMessage": "The chat will open automatically after starting to refine your slide deck."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "removeExistingNodes": true,
          "transparentConnections": true,
          "skipCategories": true,
          "layoutType": {
            "val": "none"
          },
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is the main and only function to use in your response. The `respond` function has a rich set of parameters that are fully documented in this definition. You do not need to check with me before sending back the results of the `respond` function. You should respond as soon as you are ready with the results.",
              "parameters": {
                "type": "object",
                "properties": {
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "The supporting text or data point that will appear. This can be omitted only if you provide a noun."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a unique 8 character string that you generate"
                        },
                        "noun": {
                          "type": "string",
                          "description": "What is a noun that represents this data point or concept? If provided, do NOT include a description."
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this element"
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Whether this is updating an existing element"
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "fontFamily": {
                          "type": "string",
                          "description": "Font name to use"
                        },
                        "fontSize": {
                          "type": "number",
                          "description": "Font size correlating with importance"
                        },
                        "filter": {
                          "type": "string",
                          "description": "Visual filter to apply"
                        },
                        "animation": {
                          "type": "string",
                          "description": "Animation to apply"
                        },
                        "width": {
                          "type": "number",
                          "description": "Width of the element"
                        },
                        "height": {
                          "type": "number",
                          "description": "Height of the element"
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Optional: the opacity of the element. For slide deck layouts, this should be .01. Otherwise it should be 1 unless otherwise specified."
                        },
                        "borderWidth": {
                          "type": "number",
                          "description": "Optional: the width of the border. For slide deck layouts, this should be 8. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderOpacity": {
                          "type": "number",
                          "description": "Optional: what is the opacity of the border? For slide deck layouts, this should be 1. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderStyle": {
                          "type": "string",
                          "description": "Optional: what is the layout of the border? For slide deck layouts, this should be 'solid', which should remain the default, unless otherwise specified."
                        },
                        "borderColor": {
                          "type": "string",
                          "description": "Optional: what color should the border have? This should complement the background color of the note."
                        },
                        "groupId": {
                          "type": "string",
                          "description": "Optional: when creating a slide deck presentation, all notes that are inside a given rectangle boundary should share its groupId."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "description": "Optional: this should only be populated with the parentCategoryId of the bounding rectangle when slide deck presentations are created, otherwise it should remain empty."
                        },
                        "rotationAngle": {
                          "type": "number",
                          "description": "Rotation angle in degrees"
                        },
                        "textLines": {
                          "type": "number",
                          "description": "Number of lines in this element"
                        },
                        "layoutStyle": {
                          "type": "string",
                          "description": "This always defaults to 'slideDeck'."
                        }
                      },
                      "required": [
                        "id",
                        "color",
                        "isUpdate",
                        "xPos",
                        "yPos",
                        "width",
                        "height",
                        "rotationAngle",
                        "fontFamily",
                        "fontSize",
                        "textLines",
                        "layoutStyle"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Brief synopsis of last interaction in 10 words or less"
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "\"Slide Deck Protocol: Transform {{idea}} into modular slides with VISUAL FLOW PRIORITY. Follow these rules: 1) Each slide begins with a background rectangle note (opacity:0.3, borderWidth:8, borderOpacity:1, borderStyle:'solid', width:1200±200, height:800±150). This rectangle serves as the slide frame and MUST NOT have a description. 2) All other notes for the slide MUST fit inside this rectangle and MUST include parentCategoryIds=[rectangleNoteId] as their ONLY entry. 3) Each slide must contain: a) 1 noun-note (≤3 words/emoji), b) 1 title (≤5 words) - NO description, c) 2-4 descriptions (10-20 words + 📊📈✅). 4) Slide positioning: Arrange slides in logical flow (→ ↘ ↙) with ≥200px spacing between neighboring slides. 5) Fonts: Graduate (titles:48-60px), IBM Plex Mono (data:24px), Roboto Condensed (body:18-22px). 6) Colors: #88B04B (titles), #5B5EA6 (data), #2A2A2A (borders). 7) Motion: Titles use fadeSlideUp, data uses sideToSide (duration:800ms). 8) Narrative: Build 5-7 slides progressing through Hook→Context→Insights→Climax→Resolution. 9) Constraints: NO rotationAngle, NO standalone notes, ALL text left-aligned with 80px margins. 10) Visual Flow: Use connector arrows or opacity gradients between slides when flow is non-linear. 11) Safety: Ensure child notes are positioned within ±(width/2-100) and ±(height/2-100) of the parent rectangle's center.\" {{technicalInstructions}}"
          ],
          "defaultTechnicalInstructions": "Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "postProcessing": {
            "scenarios": [
              {
                "type": "checkJSON",
                "params": [
                  "notes"
                ],
                "prompt": "You sent the following parameters as strings, but they need to be JSON: {invalidJSON}",
                "delayInSeconds": 1
              }
            ]
          }
        }
      }
    }
  },
  {
    "_id": "infographic-architect",
    "name": "Infographic Architect",
    "details": "Build a compelling infographic with a web of visual insights, using information-rich layouts that transform complex data into immediately graspable visual stories. Create a guided journey through data points using strategic visual hierarchies, intentional white space, and flowing directional cues that naturally lead the eye from insight to insight.",
    "slateName": "{{items}}",
    "gather": {
      "title": "Create your infographic",
      "message": "Describe the details of your infographic.",
      "onComplete": "",
      "items": [
        {
          "placeholder": "Describe the infographic.",
          "key": "idea",
          "required": true,
          "isPrimary": true
        }
      ],
      "order": 1,
      "footerMessage": "Start to begin crafting your infographic on an infinite canvas."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "removeExistingNodes": true,
          "transparentConnections": true,
          "layoutType": {
            "val": "ai"
          },
          "skipCategories": true,
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is the main and only function to use in your response. The `respond` function has a rich set of parameters that are fully documented in this definition. You do not need to check with me before sending back the results of the `respond` function. You should respond as soon as you are ready with the results.",
              "parameters": {
                "type": "object",
                "properties": {
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "The supporting text or data point that will appear. This can be omitted only if you provide a noun."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a unique 8 character string that you generate"
                        },
                        "groupId": {
                          "type": "string",
                          "description": "Optional: when creating a slide deck presentation, all notes that are inside a given rectangle boundary should share its groupId."
                        },
                        "noun": {
                          "type": "string",
                          "description": "What is a noun that represents this data point or concept? If provided, do NOT include a description."
                        },
                        "backgroundNoun": {
                          "type": "string",
                          "description": "Instead of a noun, you can provide a backgroundNoun for a special note (no description) that provides a background noun that enapsultes the theme of this idea. There should only be one backgroundNoun per slate, and this will be generated with a low opacity, made very large, and put behind all the other notes to emphasize cohesion."
                        },
                        "imageSearch": {
                          "type": "string",
                          "description": "What is a good image search phrase to include to represent this description? This will be used to search Google for an appropriate image, and the first available image will be used, so be as specific as possible. When providing an imageSearch parameter, the description should be 5 words or less and the opacty and borderOpacity params should be .01. The only animations that should be used when an imageSearch is provided is fadeSlideUp or fadeSlideDown. This is an optional field and should be provided only if the concept warrnts the additional visual attention."
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this note"
                        },
                        "foregroundColor": {
                          "type": "string",
                          "description": "The hex color for the description for this note"
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Whether this is updating an existing note"
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "fontFamily": {
                          "type": "string",
                          "description": "Font name to use"
                        },
                        "fontSize": {
                          "type": "number",
                          "description": "Font size correlating with importance. Should be in pt. So 15, or 180 for example."
                        },
                        "filter": {
                          "type": "string",
                          "description": "Visual filter to apply"
                        },
                        "animation": {
                          "type": "string",
                          "description": "Animation to apply"
                        },
                        "width": {
                          "type": "number",
                          "description": "Width of the note. When providing an image, this should be an approximation of the width of the image in pixels."
                        },
                        "height": {
                          "type": "number",
                          "description": "Height of the note. When providing an image, this should be an approximation of the height of the image in pixels."
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Optional: the opacity of the note. For slide deck layouts, this should be .01. Otherwise it should be 1 unless otherwise specified."
                        },
                        "borderWidth": {
                          "type": "number",
                          "description": "Optional: the width of the border. For slide deck layouts, this should be 8. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderOpacity": {
                          "type": "number",
                          "description": "Optional: what is the opacity of the border? For slide deck layouts, this should be 1. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderStyle": {
                          "type": "string",
                          "description": "Optional: what is the layout of the border? For slide deck layouts, this should be 'solid', which should remain the default, unless otherwise specified."
                        },
                        "borderColor": {
                          "type": "string",
                          "description": "Optional: what color should the border have? This should complement the background color of the note."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "description": "Optional: this should only be populated with the parentCategoryId of the bounding rectangle when slide deck presentations are created, otherwise it should remain empty."
                        },
                        "rotationAngle": {
                          "type": "number",
                          "description": "Rotation angle in degrees"
                        },
                        "textLines": {
                          "type": "number",
                          "description": "Number of lines in this note. Unless explicitly mentioned, there should be no more than 3-4 words per line, so adjust this as needed (if there are 10 words, the textLines here would be 4 then)"
                        },
                        "layoutStyle": {
                          "type": "string",
                          "description": "This always defaults to 'dynamic'."
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "This represents either an SVG graph or a funnel or pyrmiad style infographic layout, showcasing a fascinating and unexpected fact about the idea Use sufficient annotations and always include the units being graphed or put into the infographic layout (typically a number denoted on the bar, line, pie graph or the infographic funnel or pyramid structure). When building a graph, choose between a bar, line, or pie chart. Ensure a legend is included. Make the graph, funnel, or pyrmaid beautiful, with drop shadows or other filters as appropriate. Technical Requirements: (1) there should be a 5-6 word header at the top with bigger font than the rest; (2) ensure any text on the graph is black, no overlap, and positioned appropriately; (2) ensure the SVG background always has a 10px radius rect with a .4 opacity as its background (don't use css styling to do this, just this rect); (3) ensure the colors in the prompt are used throughout the SVG in a distinct way to convey meaning."
                            },
                            "description": {
                              "type": "string",
                              "description": "Summarize this visual in 10 words or less"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this visual in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this visual in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "description",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "id",
                        "color",
                        "isUpdate",
                        "xPos",
                        "yPos",
                        "width",
                        "height",
                        "rotationAngle",
                        "fontFamily",
                        "fontSize",
                        "textLines",
                        "layoutStyle"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Brief synopsis of last interaction in 10 words or less"
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "Infographic Architect: Transform all aspects of {{idea}} into a comprehensive and surprising infographic that fully covers the concept from start to finish. Use multiple notes, one backgroundNoun (a common enough single noun to convey the concept), and a single templateDetails graph to visually capture the complete scope. {{instructions}} Begin by formulating a draft of ideas, with each idea being 5-10 words. One of these ideas must always be what backgroundNoun to use. Come up with 15-20 of these ideas that clearly and provocatively communicate the concepts for this infographic. Use suspense, stakes, and surprise storytelling techniques to heighten the narrative and the 'story' behind this infographic. Only after these drafts are crafted, use the respond function to present a visual story with surprising and engaging ideas in an infographic layout. Always include: A large-font title note (2-4 words, fontSize > 80) that concisely conveys the overall theme and a backgroundNoun. Ensure all the the 15-20 planned draft ideas are elaborated upon in note pairs: First note: a single number that represents a compelling stat about the idea (no Permanent Marker font, fontSize > 80, not just the number of the idea in the list). Second note: an 8-15 word description revealing a fascinating detail about that number - that is why the number needs to be statistically relevent to this idea. Each pair must share the same groupId AND the same color. Ensure all pairs are different colors (but still adhere to color theory so they're all cohesive). Dynamic animations and occasional rotationAngle changes for visual flow (mind your xPos, yPos to avoid overlap). A unifying backgroundNoun. Noun notes (single intriguing words—no descriptions) to weave conceptual pathways. Exactly one templateDetails graph (beautiful bar, pie, or line chart) illustrating an unexpected insight. Engaging emojis are encouraged—but limit them to 2-4 total (fontSize > 80, opacity and borderOpacity 0.01) in descriptive notes. Do not include bullet lists—each fact is a separate note. For images, use imageSearch (description up to 5 words; provide an intriguing, highly specific search idea) with proportionate size (opacity/borderOpacity 0.01, animations fadeSlideUp/fadeSlideIn, filter embossed, foregroundColor #fff). Apply a variety of animations (mystery, fadeSlideUp, fadeSlideDown, bumpUpIn, bumpDownIn, impactSlide, powerSmash, torqueWarp, unroll, smoke, fractured, flux, springy). {{technicalInstructions}} If updates are needed, reference noteIds (isUpdate, deleteNoteIds). For issues, direct users to the support icon. Always provide a complete first response—never incrementally—and maintain a friendly tone with human-like explanations. Finally, always ensure a backgroundNoun is included to unify the theme."
          ],
          "defaultTechnicalInstructions": "Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "defaultInstructions": "Transform the provided idea into a visually cohesive data narrative where each element serves a clear informational purpose. Structure the content into 3-5 key data insights, with each insight forming its own visual cluster connected by directional cues and relationship indicators. Each cluster must include 1-2 'noun' notes that capture essential data points, animated with either 'breathe' or 'rotate' to draw attention to critical insights. Use rotationAngle to create visual flow between related data points, guiding viewers through the logical progression of information. Ensure that every visual element, from icons to charts, contributes to instant comprehension while maintaining clear hierarchical relationships between data points.",
          "ongoingConversationRider": "Remember, never recreate notes you have already created. If you have already provided a note with a noteId, always use isUpdate to update it. If you need to remove notes, use the deleteNoteIds array.",
          "postProcessing": {
            "scenarios": [
              {
                "type": "checkJSON",
                "params": [
                  "notes"
                ],
                "prompt": "You sent the following parameters as strings, but they need to be JSON: {invalidJSON}",
                "delayInSeconds": 1
              }
            ]
          }
        }
      }
    }
  },
  {
    "_id": "marketing-expert",
    "name": "Marketing Expert",
    "details": "Whether you would like to create a marketing plan or campaign, the Marketing Expert will help you create a compelling marketing asset.",
    "slateName": "{{items}}",
    "gather": {
      "title": "Create your marketing asset",
      "message": "What kind of marketing material would you like to produce?",
      "onComplete": "",
      "items": [
        {
          "placeholder": "Describe the marketing asset idea.",
          "key": "idea",
          "required": true,
          "isPrimary": true
        }
      ],
      "order": 1,
      "footerMessage": "Start to begin crafting your marketing asset on an infinite canvas."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "removeExistingNodes": true,
          "transparentConnections": true,
          "layoutType": {
            "val": "none"
          },
          "skipCategories": true,
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is the main and only function to use in your response. The `respond` function has a rich set of parameters that are fully documented in this definition. You do not need to check with me before sending back the results of the `respond` function. You should respond as soon as you are ready with the results.",
              "parameters": {
                "type": "object",
                "properties": {
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "The supporting text or data point that will appear. This can be omitted only if you provide a noun."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a unique 8 character string that you generate"
                        },
                        "noun": {
                          "type": "string",
                          "description": "What is a noun that represents this data point or concept? If provided, do NOT include a description."
                        },
                        "imageSearch": {
                          "type": "string",
                          "description": "What is a good image search phrase to include to represent this description? This will be used to search Google for an appropriate image, and the first available image will be used, so be as specific as possible. When providing an imageSearch parameter, the description should be 5 words or less and the opacty and borderOpacity params should be .01. The only animations that should be used when an imageSearch is provided is fadeSlideUp or fadeSlideDown. This is an optional field and should be provided only if the concept warrnts the additional visual attention."
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this note"
                        },
                        "foregroundColor": {
                          "type": "string",
                          "description": "The hex color for the description for this note"
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Whether this is updating an existing note"
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "fontFamily": {
                          "type": "string",
                          "description": "Font name to use"
                        },
                        "fontSize": {
                          "type": "number",
                          "description": "Font size correlating with importance. Should be in pt. So 15, or 180 for example."
                        },
                        "filter": {
                          "type": "string",
                          "description": "Visual filter to apply"
                        },
                        "animation": {
                          "type": "string",
                          "description": "Animation to apply"
                        },
                        "width": {
                          "type": "number",
                          "description": "Width of the note. When providing an image, this should be an approximation of the width of the image in pixels."
                        },
                        "height": {
                          "type": "number",
                          "description": "Height of the note. When providing an image, this should be an approximation of the height of the image in pixels."
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Optional: the opacity of the note. For slide deck layouts, this should be .01. Otherwise it should be 1 unless otherwise specified."
                        },
                        "borderWidth": {
                          "type": "number",
                          "description": "Optional: the width of the border. For slide deck layouts, this should be 8. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderOpacity": {
                          "type": "number",
                          "description": "Optional: what is the opacity of the border? For slide deck layouts, this should be 1. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderStyle": {
                          "type": "string",
                          "description": "Optional: what is the layout of the border? For slide deck layouts, this should be 'solid', which should remain the default, unless otherwise specified."
                        },
                        "borderColor": {
                          "type": "string",
                          "description": "Optional: what color should the border have? This should complement the background color of the note."
                        },
                        "groupId": {
                          "type": "string",
                          "description": "Optional: when creating a slide deck presentation, all notes that are inside a given rectangle boundary should share its groupId."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "description": "Optional: this should only be populated with the parentCategoryId of the bounding rectangle when slide deck presentations are created, otherwise it should remain empty."
                        },
                        "rotationAngle": {
                          "type": "number",
                          "description": "Rotation angle in degrees"
                        },
                        "textLines": {
                          "type": "number",
                          "description": "Number of lines in this note"
                        },
                        "layoutStyle": {
                          "type": "string",
                          "description": "This always defaults to 'dynamic'."
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "ONLY generate this templateDetails object when the user explicitly requests a special visualization (like a graph, infographic, flowchart, collaborative exercise, or other visual that is not simply more information) beyond standard notes. When a visualization is requested, create an engaging SVG that adheres to the request in an engaging and prescriptive manner. The SVG should be detailed, not plain, with sufficient annotations to thoroughly convey the idea. Before generating the SVG, consider: 1. Design Philosophy: Map out the visual hierarchy to represent the specific context while maintaining clarity 2. Layout Strategy: Plan note positioning to ensure text remains crisp and readable with no overlap. 3. Audience Focus: Tailor the visualization to resonate with your specific audience and stakeholders. Technical Requirements: (1) ensure the filter property on the note is always set to 'embossed' when providing the templateDetails so it appears regardless of the underlying background; (2) always ensure the SVG background is transparent when building the SVG to seamlessly integrate with any surface; (3) ensure the colors in the prompt are used throughout the SVG to convey meaning. Incorporate visual depth through thoughtful use of opacity, gradients, or patterns where appropriate. Be creative with SVG and lean into it strengths to produce something beautiful! Let the context guide your creative choices while ensuring the visualization remains both beautiful and functional."
                            },
                            "description": {
                              "type": "string",
                              "description": "Summarize this visual in 10 words or less"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this visual in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this visual in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "stickyNotesToCreate",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "id",
                        "color",
                        "isUpdate",
                        "xPos",
                        "yPos",
                        "width",
                        "height",
                        "rotationAngle",
                        "fontFamily",
                        "fontSize",
                        "textLines",
                        "layoutStyle"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Brief synopsis of last interaction in 10 words or less"
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "Marketing Impact Architect: Transform {{idea}} into a conversion-focused narrative that expertly weaves together market pain points and compelling solutions, using persuasive layouts that build undeniable value propositions. Structure the experience to mirror the buyer's journey, with each segment strategically positioned to overcome objections and drive action through powerful single-word and short-phrase messaging. {{instructions}} Please respond thoroughly to this idea the first time; deliver all of the notes as requested immediately, do not reduce the scope here and start with a limited series of notes. The overarching design should reflect marketing-oriented layouts that capture the idea's value proposition and customer journey, enhanced by dynamic animations, smooth zoom transitions, and strategic rotationAngle cues to emphasize key conversion points. The layout should break down complex marketing concepts into single words or short phrases that build compelling narratives focused on market problems and solutions. Unless otherwise told, intersperse creative and engaging emojis into their own note in the 'description' parameter (not the noun parameter) with larger font sizes (>50) than the text they're accompanying. These emoji notes should have opacity and borderOpacity set to .01. You can also provide an imageSearch parameter with notes - this will be used as a google image search to find an appropriate way to highlight this note. When providing an imageSearch, you must enforce the following options: (1) the description is 5 words or less, (2) the imageSearch param is highly specific for the meaning, (3) its width and height of the note are appropriately sized based on your estimation of what the resulting image size would be, relative to the other notes, (4) the opacity and borderOpacity parameters must be set to .01, (5) the only animations to apply should be either fadeSlideUp and fadeSlideIn, and (6) the filter should always be set to 'embossed'. If the user asks for a visualization that is not suitable for just another note with text, then leverage the templateDetails object to create a custom visual SVG that meets their expectation. When creating graphs, double check your work to ensure the SVG proportions are correct. When creating other visualizations, double check that text is well spaced and not overlapping. When constructing notes, leverage a rich palette of animations (mystery, fadeSlideUp, fadeSlideDown, bumpUpIn, bumpDownIn, impactSlide, powerSmash, torqueWarp, unroll, smoke, fractured, flux, springy). {{technicalInstructions}} After the initial layout, review the design and iterate until perfection by specifying noteIds for modifications (using isUpdate) or removals (using deleteNoteIds). For any issues, direct users to the support icon for guidance."
          ],
          "defaultTechnicalInstructions": "Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "defaultInstructions": "Transform the provided idea into a persuasive marketing narrative that follows conversion optimization principles. Structure the content into 3-5 key marketing segments that mirror the buyer's journey from problem awareness to solution adoption. Each segment must include 1-2 'noun' notes that capture essential value propositions or market insights, animated with either 'breathe' or 'rotate' to emphasize conversion triggers. Use rotationAngle to mark critical decision points in the customer journey. Each segment should clearly articulate both a market pain point and its corresponding solution, with persuasive language that builds emotional resonance while driving toward clear calls to action.",
          "postProcessing": {
            "scenarios": [
              {
                "type": "checkJSON",
                "params": [
                  "notes"
                ],
                "prompt": "You sent the following parameters as strings, but they need to be JSON: {invalidJSON}",
                "delayInSeconds": 1
              }
            ]
          }
        }
      }
    }
  },
  {
    "_id": "populate-template",
    "name": "Template Population",
    "details": "Brainstorm with sticky notes.",
    "basedOnTemplate": true,
    "slateName": "Auto Template",
    "gather": {
      "title": "{{templateName}}",
      "message": "Please provide context below. You can type or paste-in relevant information for this {{templateName}} analysis. Additionally, you can provide more context by uploading a pdf or text file.",
      "onComplete": "populateCenterNode",
      "items": [
        {
          "placeholder": "How should we approach the {{templateName}}? Provide details here. You can also upload a support document below for more context.",
          "key": "instructions",
          "type": "textarea",
          "size": 1000,
          "required": true
        }
      ],
      "order": 1,
      "footerMessage": "Once you start this conversation, the chat will open automatically so you can refine and ask more questions about the {{templateName}}. You can also turn on your mic and talk directly to the AI about the document."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "layoutType": {
            "val": "none"
          },
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is the only function you should use. The `respond` function is how you return the note ideas that belong to the template in question.",
              "parameters": {
                "type": "object",
                "properties": {
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "This is a description of the idea. This must be 10 words or less."
                        },
                        "color": {
                          "type": "string",
                          "description": "What is the hex background color of this node? This should match the color defined for its parentCategoryId."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "description": "What is the one category name that this note belongs to? Populate the first element of the parentCategoryIds with one of the categories provided in the prompt. Only provide one categoryId in this array."
                          }
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a UNIQUE 8 character string that you generate."
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Are you updating this note or creating a new one? If updating, set this parameter to true, otherwise false"
                        },
                        "styleNodeId": {
                          "type": "string",
                          "description": "Copy the style from this node."
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "This is the entire <svg>...</svg> string that makes up the visualization being requested. Users can ask for special visualizations to be produced (infographics, flowcharts, etc) or perhaps a specific kind of group activity where users can put virtual sticky notes. In either case, be creative and highly specific when producing these visualizations. Whatever is asked for, these visualizations or collaborative exercises need to be highly specific to the context being analyzed. Prior to building the svg, make a plan on how you think it should look to ensure beautiful design, no text overlap, and clarity for the audience and stakeholders you are working with. Always ensure the background of the SVG is white. Be specific in building the SVG visualization with details from the context."
                            },
                            "stickyNotesToCreate": {
                              "type": "number",
                              "description": "How many sticky notes should be created?"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this template in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this template in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "stickyNotesToCreate",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "description",
                        "id",
                        "isUpdate"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Use the suggestion to describe what we last discussed. Keep suggestions to 50 words or less. This field is required."
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "Include the array of all noteIds you want deleted here. In our conversation, if I ask for any of the  to be refined or redone, delete any affected noteIds here. This field is optional."
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "You are an expert colleague collaborating with me on a {{templateName}} whiteboard. Your job is to return sticky-notes that we populate all the categories on the whiteboard. These should be sent back as 'notes' in the respond function, and they should be succinct and highly detailed to the category. They don't necessarily need to be full sentences, but words and phrases that best describe the thought. Keep each idea to 10 words or less. An important caveat: IF additional source material is supplied, then every note MUST include a page citation (page X) at the end that denotes where the idea originated from. So any time an external reference is supplied, all notes must include this citation. As we continue to have a conversation about this whiteboard, please be proactive in asking which categories we should fill out first. Create as many sticky notes per category as the user asks. The user may ask for notes to be created right away, so ensure you follow their instructions and create as many notes per category as they are asking. Again, ensure you deeply analyze any attached documents for additional context before responding and never make up information. Every note must include a citation when additional documents are provided. Use #FEFCB0 as the color for every note. The topic for this {{templateName}} is: {{instructions}} {{templatePrompt}}Use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony."
          ],
          "isVision": true,
          "removeExistingNodes": false,
          "useWhenValuesPopulated": [],
          "voiceId": "alloy",
          "function_call": {
            "type": "any"
          },
          "defaultShapes": {
            "category": "circle",
            "note": "stickyNote"
          },
          "sentenceBatchSize": 1
        }
      }
    }
  },
  {
    "_id": "expert-collaborator",
    "name": "Expert Collaboration",
    "details": "Build mind-maps and diagrams in an open-ended conversation.",
    "isDefault": true,
    "slateName": "Expert Discussion",
    "gather": {
      "title": "Let's chat!",
      "message": "What is this idea about?",
      "onComplete": "",
      "items": [
        {
          "placeholder": "I'd like to chat about...",
          "key": "idea",
          "defaultValue": "",
          "type": "textfield",
          "isPrimary": true,
          "required": true
        }
      ],
      "order": 1,
      "footerMessage": "Once you start this conversation, the chat will open automatically so you can refine and ask more questions about the idea. Ask anything! You can also turn on your mic and chat away."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "removeExistingNodes": true,
          "layoutType": {
            "val": "dot",
            "overlap": "compress",
            "rankdir": "TB"
          },
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is your response to the last query",
              "parameters": {
                "type": "object",
                "properties": {
                  "categories": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "This is the category description."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a UNIQUE 8 character string that you generate. This field is required."
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this category"
                        },
                        "foregroundColor": {
                          "type": "string",
                          "description": "The hex color for the description - either black or white, for best contrast with the color property."
                        },
                        "textLines": {
                          "type": "number",
                          "description": "How many newlines in this description? We want 1 word per line here, so textLines should be equal to the number of words in the description."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "description": "What is this category's parentCategoryIds? You can use 'main' if it is connected to the main topic."
                          }
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Are you updating this category or creating a new one? If updating, set this parameter to true, otherwise false"
                        }
                      },
                      "required": [
                        "description",
                        "id",
                        "textLines",
                        "color",
                        "foregroundColor",
                        "parentCategoryIds",
                        "isUpdate"
                      ]
                    }
                  },
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "This is a description of the note."
                        },
                        "textLines": {
                          "type": "number",
                          "description": "How many newlines in this description? We want 3-4 words per note, so if there are 10 words, the textLines would be 4."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a UNIQUE 8 character string that you generate."
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this note"
                        },
                        "foregroundColor": {
                          "type": "string",
                          "description": "The hex color for the description - either black or white, for best contrast with the color property."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "description": "What is this notes's parentCategoryIds? You can use 'main' if it is connected to the main topic."
                          }
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Are you updating this note or creating a new one? If updating, set this parameter to true, otherwise false"
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "ONLY generate this templateDetails object when the user explicitly requests a special visualization (like an infographic, flowchart, or collaborative exercise) beyond standard notes and categories. This is NOT for regular mind mapping - only for supplementary visuals when specifically asked.\n\nWhen a visualization is requested, create an engaging SVG that brings the context to life. Before generating the SVG, consider:\n\n1. Design Philosophy: Map out the visual hierarchy to represent the specific context while maintaining clarity\n2. Layout Strategy: Plan element positioning to ensure text remains crisp and readable with no overlap\n3. Audience Focus: Tailor the visualization to resonate with your specific audience and stakeholders\n\nTechnical Requirements:\n- Maintain transparent backgrounds to seamlessly integrate with any surface\n- Apply a subtle yet distinctive filter effect across the entire SVG (e.g., a soft glow, gentle shadow, or delicate backdrop-filter)\n- Incorporate visual depth through thoughtful use of opacity, gradients, or patterns where appropriate\n\nLet the context guide your creative choices while ensuring the visualization remains both beautiful and functional."
                            },
                            "description": {
                              "type": "string",
                              "description": "Summarize this visual in 10 words or less"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this template in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this template in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "description",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "description",
                        "id",
                        "xPos",
                        "yPos",
                        "color",
                        "foregroundColor",
                        "textLines",
                        "parentCategoryIds",
                        "isUpdate"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Always include a suggestion with every response that briefly highlights what was just added. Keep these suggestions to 20 words or less."
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "Include the array of all noteIds that I have asked you to remove here. This field is optional."
                    }
                  },
                  "deleteCategoryIds": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "Include the array of all categoryIds that I have asked you to remove here. This field is optional."
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "Let's brainstorm a topic together to build a mind map. As the expert, you will collaborate with me to create an insightful and well-structured visualization of {{idea}}. {{instructions}} Your role is to draw from comprehensive knowledge while critically assessing sources and reliability. Follow these instructions carefully: 1. Depth and Nuance: Provide specific, in-depth perspectives beyond surface-level analysis to generate original and meaningful insights. 2. Mind Map Structure: - Position the main idea/category at the center of the map (x:1000, y:1000) as the focal point - Arrange all other categories in a circle around the center, distributing them evenly with equal spacing apart - Use appropriate spacing between notes by factoring in each node's width and height to prevent overlapping (assume a minimum of 150px width and 80px height per note) - When positioning notes, position them around each category in a circular patern - Assign the same color to each note as its parent category for clarity. 3. Text length - ensure that category description stay short and succint, around 1-5 words. Notes can be longer around 10-15 words or longer as the user asks. 4. Visualizations: - Never produce any visualizations when you first build out the mindmap, but if special visualizations are requested (e.g., graphs, charts, infographics, flowcharts, interactive exercises), use the `templateDetails` parameter to generate them. - Interpret these visualization needs creatively while ensuring they serve a clear analytical purpose in exploring the topic. Position these templateDetails near the respective notes or categories but be mindful of their larger width and height sizes and so the x,y coordinates must ensure there is sufficient spacing. 5. Context and Coherence: - Maintain continuity by incorporating any `echoNodeId` provided. - Each addition should be purposeful, deepening the analysis or opening new avenues for discussion. 6. {{technicalInstructions}} Any child nodes should have lighter variants of the same color of their parent. Inform the user in a concise way that they can further converse with you to modify the colors based on whatever color scheme is discussed and your usage of color theory to produce this theme. 7. Avoid any redundant notes or categories. Strive for original thoughts! Ensure the user understands that you can create graphs and other special visualizations. Ensure the user knows that if they want to create a whole new topic or build something other than a mindmap within the parameters outlined here, then they need to start a new slate."
          ],
          "defaultTechnicalInstructions": "Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "defaultShapes": {
            "category": "circle",
            "note": "stickyNote"
          },
          "sentenceBatchSize": 1,
          "voiceId": "alloy",
          "function_call": {
            "name": "respond"
          }
        }
      }
    }
  },
  {
    "_id": "timeline-visualizer",
    "name": "Timeline Visualizer",
    "details": "Create a compelling timeline visualization of the provided idea, using a chronological flow of time from left to right",
    "slateName": "{{items}}",
    "gather": {
      "title": "Create your timeline of events",
      "message": "Describe what the timeline should represent.",
      "onComplete": "",
      "items": [
        {
          "placeholder": "Describe the timeline.",
          "key": "idea",
          "required": true,
          "isPrimary": true
        }
      ],
      "order": 1,
      "footerMessage": "Start to begin crafting your timeline on an infinite canvas."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "removeExistingNodes": true,
          "transparentConnections": true,
          "layoutType": {
            "val": "none"
          },
          "skipCategories": true,
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is the main and only function to use in your response. The `respond` function has a rich set of parameters that are fully documented in this definition. You do not need to check with me before sending back the results of the `respond` function. You should respond as soon as you are ready with the results.",
              "parameters": {
                "type": "object",
                "properties": {
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "The supporting text or data point that will appear. This can be omitted only if you provide a noun."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a unique 8 character string that you generate"
                        },
                        "groupId": {
                          "type": "string",
                          "description": "Optional: when creating a slide deck presentation, all notes that are inside a given rectangle boundary should share its groupId."
                        },
                        "noun": {
                          "type": "string",
                          "description": "What is a noun that represents this data point or concept? If provided, do NOT include a description."
                        },
                        "imageSearch": {
                          "type": "string",
                          "description": "What is a good image search phrase to include to represent this description? This will be used to search Google for an appropriate image, and the first available image will be used, so be as specific as possible. When providing an imageSearch parameter, the description should be 5 words or less and the opacty and borderOpacity params should be .01. The only animations that should be used when an imageSearch is provided is fadeSlideUp or fadeSlideDown. This is an optional field and should be provided only if the concept warrnts the additional visual attention."
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this note"
                        },
                        "foregroundColor": {
                          "type": "string",
                          "description": "The hex color for the description for this note"
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Whether this is updating an existing note"
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "fontFamily": {
                          "type": "string",
                          "description": "Font name to use"
                        },
                        "fontSize": {
                          "type": "number",
                          "description": "Font size correlating with importance. Should be in pt. So 15, or 180 for example."
                        },
                        "filter": {
                          "type": "string",
                          "description": "Visual filter to apply"
                        },
                        "animation": {
                          "type": "string",
                          "description": "Animation to apply"
                        },
                        "width": {
                          "type": "number",
                          "description": "Width of the note. When providing an image, this should be an approximation of the width of the image in pixels."
                        },
                        "height": {
                          "type": "number",
                          "description": "Height of the note. When providing an image, this should be an approximation of the height of the image in pixels."
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Optional: the opacity of the note. For slide deck layouts, this should be .01. Otherwise it should be 1 unless otherwise specified."
                        },
                        "borderWidth": {
                          "type": "number",
                          "description": "Optional: the width of the border. For slide deck layouts, this should be 8. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderOpacity": {
                          "type": "number",
                          "description": "Optional: what is the opacity of the border? For slide deck layouts, this should be 1. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderStyle": {
                          "type": "string",
                          "description": "Optional: what is the layout of the border? For slide deck layouts, this should be 'solid', which should remain the default, unless otherwise specified."
                        },
                        "borderColor": {
                          "type": "string",
                          "description": "Optional: what color should the border have? This should complement the background color of the note."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "description": "Optional: this should only be populated with the parentCategoryId of the bounding rectangle when slide deck presentations are created, otherwise it should remain empty."
                        },
                        "rotationAngle": {
                          "type": "number",
                          "description": "Rotation angle in degrees"
                        },
                        "textLines": {
                          "type": "number",
                          "description": "Number of lines in this note"
                        },
                        "layoutStyle": {
                          "type": "string",
                          "description": "This always defaults to 'dynamic'."
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "ONLY generate this templateDetails object when the user explicitly requests a special visualization (like a graph, infographic, flowchart, collaborative exercise, or other visual that is not simply more information) beyond standard notes. When a visualization is requested, create an engaging SVG that adheres to the request in an engaging and prescriptive manner. The SVG should be detailed, not plain, with sufficient annotations to thoroughly convey the idea. Before generating the SVG, consider: 1. Design Philosophy: Map out the visual hierarchy to represent the specific context while maintaining clarity 2. Layout Strategy: Plan note positioning to ensure text remains crisp and readable with no overlap. 3. Audience Focus: Tailor the visualization to resonate with your specific audience and stakeholders. Technical Requirements: (1) ensure the filter property on the note is always set to 'embossed' when providing the templateDetails so it appears regardless of the underlying background; (2) always ensure the SVG background is transparent when building the SVG to seamlessly integrate with any surface; (3) ensure the colors in the prompt are used throughout the SVG to convey meaning. Incorporate visual depth through thoughtful use of opacity, gradients, or patterns where appropriate. Be creative with SVG and lean into it strengths to produce something beautiful! Let the context guide your creative choices while ensuring the visualization remains both beautiful and functional."
                            },
                            "description": {
                              "type": "string",
                              "description": "Summarize this visual in 10 words or less"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this visual in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this visual in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "stickyNotesToCreate",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "id",
                        "color",
                        "isUpdate",
                        "xPos",
                        "yPos",
                        "width",
                        "height",
                        "rotationAngle",
                        "fontFamily",
                        "fontSize",
                        "textLines",
                        "layoutStyle"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Brief synopsis of last interaction in 10 words or less"
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "Chronological Flow Architect: Transform {{idea}} into a time-anchored spatial journey that reveals the natural progression and cadence of events, using left-to-right timeline layouts that amplify temporal relationships and historical context; every timeline must feature large (>100pt font) time units (numeric) plus at lest 3 or more notes with descriptions with fonts that are 80% smaller than the time unit font that describe the event in a surprising and engaging way, and one of these notes should be an image. All these notes within a time unit should have the same groupId. {{instructions}} Create an outline for this timeline of 15-20 ideas and keep each idea to 5 words. This outline must clearly and provocatively communicate the timeline being requested. Use suspense, stakes, and surprise storytelling techniques to heighten the timeline and the story being told. Only once this outline is produced, use the respond function to thoroughly provide all notes. Double-check text placement and spacing to avoid x,y overlap. The width should follow this formula: numberOfCharacters * fontSize * 0.8 = dimensions in pixels. So if a note has 100pt font with 4 characters, it would be 4 * 100 * .8 = 320px wide. The design should be timeline-centric, enhanced by dynamic animations, smooth zoom transitions, and occasional rotationAngle cues to mark significant temporal shifts; the central timeline runs left to right, with each major time unit in font size >150 at the top. Unless otherwise instructed, intersperse fun emojis in separate 'description' notes (font size >80, opacity=.01, borderOpacity=.01). You can also add imageSearch parameters on notes (description ≤5 words, highly specific imageSearch, note sized reasonably, opacity=.01, borderOpacity=.01, animation fadeSlideUp or fadeSlideIn, filter='embossed'). If a user’s request calls for a custom visualization, use templateDetails for an SVG; ensure proper proportions and spacing. When constructing notes, use a rich palette of animations (mystery, fadeSlideUp, fadeSlideDown, bumpUpIn, bumpDownIn, impactSlide, powerSmash, torqueWarp, unroll, smoke, fractured, flux, springy). {{technicalInstructions}} After laying it out, refine if needed by specifying noteIds with isUpdate or using deleteNoteIds to remove. For any issues, direct users to the support icon."
          ],
          "defaultTechnicalInstructions": "Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "defaultInstructions": "Transform the provided idea into a temporal tapestry where time units serve as the backbone of the narrative. Each time unit should be prominently displayed along a left-to-right timeline, with supporting content naturally clustering around these chronological anchors. The layout should organize events into 3-7 distinct time periods, with each period's content radiating outward from its central time marker. Each time period must include 1-2 'noun' notes carrying pivotal moments that define that era, animated with either 'breathe' or 'rotate' to emphasize their historical significance. Use rotationAngle exclusively to denote paradigm shifts or pivotal historical turning points. Content clusters should visually connect through subtle animations that suggest cause-and-effect relationships across time.",
          "postProcessing": {
            "scenarios": [
              {
                "type": "checkJSON",
                "params": [
                  "notes"
                ],
                "prompt": "You sent the following parameters as strings, but they need to be JSON: {invalidJSON}",
                "delayInSeconds": 1
              }
            ]
          }
        }
      }
    }
  },
  {
    "_id": "dynamic-presentation",
    "name": "Dynamic Presentation",
    "details": "Craft immersive, story-telling experiences using free-form layouts and creative visual storytelling.",
    "slateName": "{{items}}",
    "gather": {
      "title": "Create your dynamic presentation",
      "message": "What dynamic presentation would you like to tell?",
      "onComplete": "",
      "items": [
        {
          "placeholder": "Describe the dyamic presenation idea.",
          "key": "idea",
          "required": true,
          "isPrimary": true
        }
      ],
      "order": 1,
      "footerMessage": "Start to begin crafting your dynamic presentation on an infinite canvas."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "removeExistingNodes": true,
          "transparentConnections": true,
          "layoutType": {
            "val": "none"
          },
          "skipCategories": true,
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is the main and only function to use in your response. The `respond` function has a rich set of parameters that are fully documented in this definition. You do not need to check with me before sending back the results of the `respond` function. You should respond as soon as you are ready with the results.",
              "parameters": {
                "type": "object",
                "properties": {
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "The supporting text or data point that will appear. This can be omitted only if you provide a noun."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a unique 8 character string that you generate"
                        },
                        "noun": {
                          "type": "string",
                          "description": "What is a noun that represents this data point or concept? If provided, do NOT include a description."
                        },
                        "imageSearch": {
                          "type": "string",
                          "description": "What is a good image search phrase to include to represent this description? This will be used to search Google for an appropriate image, and the first available image will be used, so be as specific as possible. When providing an imageSearch parameter, the description should be 5 words or less and the opacty and borderOpacity params should be .01. The only animations that should be used when an imageSearch is provided is fadeSlideUp or fadeSlideDown. This is an optional field and should be provided only if the concept warrnts the additional visual attention."
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this note"
                        },
                        "foregroundColor": {
                          "type": "string",
                          "description": "The hex color for the description for this note"
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Whether this is updating an existing note"
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "fontFamily": {
                          "type": "string",
                          "description": "Font name to use"
                        },
                        "fontSize": {
                          "type": "number",
                          "description": "Font size correlating with importance. Should be in pt. So 15, or 180 for example."
                        },
                        "filter": {
                          "type": "string",
                          "description": "Visual filter to apply"
                        },
                        "animation": {
                          "type": "string",
                          "description": "Animation to apply"
                        },
                        "width": {
                          "type": "number",
                          "description": "Width of the note. When providing an image, this should be an approximation of the width of the image in pixels."
                        },
                        "height": {
                          "type": "number",
                          "description": "Height of the note. When providing an image, this should be an approximation of the height of the image in pixels."
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Optional: the opacity of the note. For slide deck layouts, this should be .01. Otherwise it should be 1 unless otherwise specified."
                        },
                        "borderWidth": {
                          "type": "number",
                          "description": "Optional: the width of the border. For slide deck layouts, this should be 8. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderOpacity": {
                          "type": "number",
                          "description": "Optional: what is the opacity of the border? For slide deck layouts, this should be 1. Otherwise this can be set to 0 unless otherwise specified."
                        },
                        "borderStyle": {
                          "type": "string",
                          "description": "Optional: what is the layout of the border? For slide deck layouts, this should be 'solid', which should remain the default, unless otherwise specified."
                        },
                        "borderColor": {
                          "type": "string",
                          "description": "Optional: what color should the border have? This should complement the background color of the note."
                        },
                        "groupId": {
                          "type": "string",
                          "description": "Optional: when creating a slide deck presentation, all notes that are inside a given rectangle boundary should share its groupId."
                        },
                        "parentCategoryIds": {
                          "type": "array",
                          "description": "Optional: this should only be populated with the parentCategoryId of the bounding rectangle when slide deck presentations are created, otherwise it should remain empty."
                        },
                        "rotationAngle": {
                          "type": "number",
                          "description": "Rotation angle in degrees"
                        },
                        "textLines": {
                          "type": "number",
                          "description": "Number of lines in this note"
                        },
                        "layoutStyle": {
                          "type": "string",
                          "description": "This always defaults to 'dynamic'."
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "ONLY generate this templateDetails object when the user explicitly requests a special visualization (like a graph, infographic, flowchart, collaborative exercise, or other visual that is not simply more information) beyond standard notes. When a visualization is requested, create an engaging SVG that adheres to the request in an engaging and prescriptive manner. The SVG should be detailed, not plain, with sufficient annotations to thoroughly convey the idea. Before generating the SVG, consider: 1. Design Philosophy: Map out the visual hierarchy to represent the specific context while maintaining clarity 2. Layout Strategy: Plan note positioning to ensure text remains crisp and readable with no overlap. 3. Audience Focus: Tailor the visualization to resonate with your specific audience and stakeholders. Technical Requirements: (1) ensure the filter property on the note is always set to 'embossed' when providing the templateDetails so it appears regardless of the underlying background; (2) always ensure the SVG background is transparent when building the SVG to seamlessly integrate with any surface; (3) ensure the colors in the prompt are used throughout the SVG to convey meaning. Incorporate visual depth through thoughtful use of opacity, gradients, or patterns where appropriate. Be creative with SVG and lean into it strengths to produce something beautiful! Let the context guide your creative choices while ensuring the visualization remains both beautiful and functional."
                            },
                            "description": {
                              "type": "string",
                              "description": "Summarize this visual in 10 words or less"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this visual in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this visual in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "stickyNotesToCreate",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "id",
                        "color",
                        "isUpdate",
                        "xPos",
                        "yPos",
                        "width",
                        "height",
                        "rotationAngle",
                        "fontFamily",
                        "fontSize",
                        "textLines",
                        "layoutStyle"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Brief synopsis of last interaction in 10 words or less"
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "Dynamic Presentation Storyteller: Transform {{idea}} {{instructions}} Create an outline for this presentation of 15-20 ideas and keep each idea to 5 words. This outline must clearly and provocatively communicate the presentation being requested. Use suspense, stakes, and surprise storytelling techniques to heighten the presentation and the story being told. Only once this outline is produced, use the respond function to send all the notes down the first time. Deliver all of the notes immediately, do not reduce the scope here and start with a limited number. The overarching design should reflect storytelling-focused layouts that capture the idea's emotional journey and narrative progression, enhanced by dynamic animations, smooth zoom transitions, and dramatic rotationAngle cues to mark story beats. Bold visual concepts should guide users through the narrative, creating an immersive story experience. Unless otherwise told, intersperse creative and engaging emojis into their own note in the 'description' parameter (not the noun parameter) with larger font sizes (>90) than the text they're accompanying. These emoji notes should have opacity and borderOpacity set to .01. You can also provide an imageSearch parameter with notes - this will be used as a google image search to find an appropriate way to highlight this note. The imageSearch parameter itself should never be set on the description, only on the imageSearch parameter itself. When providing an imageSearch, you must enforce the following options: (1) the description is 5 words or less that enlivens the image - it does not need to report on what the image is, (2) the imageSearch param needs to be highly specific so the most appropriate image is found when searching, (3) its width and height of the note are appropriately sized based on your estimation of what the resulting image size would be, relative to the other notes, (4) the opacity and borderOpacity parameters must be set to .01, (5) the only animations to apply should be either fadeSlideUp and fadeSlideIn, and (6) the filter should always be set to 'embossed'. If the user asks for a visualization that is not suitable for just another note with text, then leverage the templateDetails object to create a custom visual SVG that meets their expectation. Be creative when producing these visuals and try to incorporate them into the visual flow of the rest of the presentation. When creating graphs, double check your work to ensure the SVG proportions are correct. When creating other visualizations, double check that text is well spaced and not overlapping. When building notes, leverage a rich palette of animations (mystery, fadeSlideUp, fadeSlideDown, bumpUpIn, bumpDownIn, impactSlide, powerSmash, torqueWarp, unroll, smoke, fractured, flux, springy). {{technicalInstructions}} After the initial layout, review the design and iterate until perfection by specifying noteIds for modifications (using isUpdate) or removals (using deleteNoteIds). For any issues, direct users to the support icon for guidance."
          ],
          "defaultTechnicalInstructions": "Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "defaultInstructions": "Transform the provided idea into a captivating visual presentation that follows classic storytelling principles. Structure the content into 3-5 key story beats that build emotional resonance while maintaining narrative tension. Each beat must include 1-2 'noun' notes that capture pivotal story moments or character developments, animated with either 'breathe' or 'rotate' to emphasize dramatic weight. Use rotationAngle to mark major emotional transitions or plot twists. Each story segment should carefully balance visual impact with narrative progression, creating seamless flows between scenes while building toward a satisfying narrative arc.",
          "postProcessing": {
            "scenarios": [
              {
                "type": "checkJSON",
                "params": [
                  "notes"
                ],
                "prompt": "You sent the following parameters as strings, but they need to be JSON: {invalidJSON}",
                "delayInSeconds": 1
              }
            ]
          }
        }
      }
    }
  },
  {
    "_id": "pitch-deck-writer",
    "name": "Pitch Deck Writer",
    "details": "Build problem-to-solution pitch decks that convert!",
    "slateName": "{{items}}",
    "gather": {
      "title": "What is this pitch deck about?",
      "message": "Provide details on what you would like to pitch.",
      "onComplete": "",
      "items": [
        {
          "placeholder": "Describe the product being pitched.",
          "key": "idea",
          "required": true,
          "isPrimary": true
        }
      ],
      "order": 1,
      "footerMessage": "Start to begin crafting your pitch deck on an infinite canvas."
    },
    "ai": {
      "decisionTree": {
        "inline": {
          "removeExistingNodes": true,
          "transparentConnections": true,
          "layoutType": {
            "val": "none"
          },
          "skipCategories": true,
          "autoOpenChat": true,
          "errorChecks": [],
          "functions": [
            {
              "name": "respond",
              "description": "This is the main and only function to use in your response. The `respond` function has a rich set of parameters that are fully documented in this definition. You do not need to check with me before sending back the results of the `respond` function. You should respond as soon as you are ready with the results.",
              "parameters": {
                "type": "object",
                "properties": {
                  "notes": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "description": {
                          "type": "string",
                          "description": "The supporting text or data point that will appear. This can be omitted only if you provide a noun."
                        },
                        "id": {
                          "type": "string",
                          "description": "This is a unique 8 character string that you generate"
                        },
                        "noun": {
                          "type": "string",
                          "description": "What is a noun that represents this data point or concept? If provided, do NOT include a description."
                        },
                        "imageSearch": {
                          "type": "string",
                          "description": "What is a good image search phrase to include to represent this description? This will be used to search Google for an appropriate image, and the first available image will be used, so be as specific as possible. When providing an imageSearch parameter, the description should be 5 words or less and the opacty and borderOpacity params should be .01. The only animations that should be used when an imageSearch is provided is fadeSlideUp or fadeSlideDown. This is an optional field and should be provided only if the concept warrnts the additional visual attention."
                        },
                        "color": {
                          "type": "string",
                          "description": "The hex color code for this note"
                        },
                        "foregroundColor": {
                          "type": "string",
                          "description": "The hex color for the description for this note"
                        },
                        "isUpdate": {
                          "type": "boolean",
                          "description": "Whether this is updating an existing note"
                        },
                        "xPos": {
                          "type": "number",
                          "description": "X coordinate position"
                        },
                        "yPos": {
                          "type": "number",
                          "description": "Y coordinate position"
                        },
                        "fontFamily": {
                          "type": "string",
                          "description": "Font name to use"
                        },
                        "fontSize": {
                          "type": "number",
                          "description": "Font size correlating with importance. Should be in pt. So 15, or 180 for example."
                        },
                        "filter": {
                          "type": "string",
                          "description": "Visual filter to apply"
                        },
                        "animation": {
                          "type": "string",
                          "description": "Animation to apply. Available: mystery, fadeSlideUp, fadeSlideDown, bumpUpIn, bumpDownIn, impactSlide, powerSmash, torqueWarp, smoke, fractured, flux, springy."
                        },
                        "width": {
                          "type": "number",
                          "description": "Width of the note. When providing an image, this should be an approximation of the width of the image in pixels."
                        },
                        "height": {
                          "type": "number",
                          "description": "Height of the note. When providing an image, this should be an approximation of the height of the image in pixels."
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Optional: the opacity of the note. This should be 1 unless otherwise specified."
                        },
                        "borderWidth": {
                          "type": "number",
                          "description": "Optional: the width of the border. This can be set to 0 unless otherwise specified."
                        },
                        "borderOpacity": {
                          "type": "number",
                          "description": "Optional: what is the opacity of the border? This can be set to 0 unless otherwise specified."
                        },
                        "borderStyle": {
                          "type": "string",
                          "description": "Optional: what is the layout of the border? This should be solid unless otherwise specified."
                        },
                        "borderColor": {
                          "type": "string",
                          "description": "Optional: what color should the border have? This should complement the background color of the note."
                        },
                        "groupId": {
                          "type": "string",
                          "description": "Optional: when creating a slide deck presentation, all notes that are inside a given rectangle boundary should share its groupId."
                        },
                        "rotationAngle": {
                          "type": "number",
                          "description": "Rotation angle in degrees"
                        },
                        "textLines": {
                          "type": "number",
                          "description": "Number of lines in this note"
                        },
                        "layoutStyle": {
                          "type": "string",
                          "description": "This always defaults to 'dynamic'."
                        },
                        "templateDetails": {
                          "type": "object",
                          "properties": {
                            "svgString": {
                              "type": "string",
                              "description": "ONLY generate this templateDetails object when the user explicitly requests a special visualization (like a graph, infographic, flowchart, collaborative exercise, or other visual that is not simply more information) beyond standard notes. When a visualization is requested, create an engaging SVG that adheres to the request in an engaging and prescriptive manner. The SVG should be detailed, not plain, with sufficient annotations to thoroughly convey the idea. Before generating the SVG, consider: 1. Design Philosophy: Map out the visual hierarchy to represent the specific context while maintaining clarity 2. Layout Strategy: Plan note positioning to ensure text remains crisp and readable with no overlap. 3. Audience Focus: Tailor the visualization to resonate with your specific audience and stakeholders. Technical Requirements: (1) ensure the filter property on the note is always set to 'embossed' when providing the templateDetails so it appears regardless of the underlying background; (2) always ensure the SVG background is transparent when building the SVG to seamlessly integrate with any surface; (3) ensure the colors in the prompt are used throughout the SVG to convey meaning. Incorporate visual depth through thoughtful use of opacity, gradients, or patterns where appropriate. Be creative with SVG and lean into it strengths to produce something beautiful! Let the context guide your creative choices while ensuring the visualization remains both beautiful and functional."
                            },
                            "description": {
                              "type": "string",
                              "description": "Summarize this visual in 10 words or less"
                            },
                            "width": {
                              "type": "number",
                              "description": "What is the width of this visual in pixels?"
                            },
                            "height": {
                              "type": "number",
                              "description": "What is the height of this visual in pixels?"
                            }
                          },
                          "required": [
                            "svgString",
                            "stickyNotesToCreate",
                            "width",
                            "height"
                          ]
                        }
                      },
                      "required": [
                        "id",
                        "color",
                        "isUpdate",
                        "xPos",
                        "yPos",
                        "width",
                        "height",
                        "rotationAngle",
                        "fontFamily",
                        "fontSize",
                        "textLines",
                        "layoutStyle"
                      ]
                    }
                  },
                  "suggestion": {
                    "type": "string",
                    "description": "Brief synopsis of last interaction in 10 words or less"
                  },
                  "deleteNoteIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": [
                  "suggestion"
                ]
              }
            }
          ],
          "prompts": [
            "Pitch Deck Impact Architect: Transform {{idea}} into an impactful pitch deck narrative that explicitly identifies the core market issue, vividly illustrates the problem addressed, and presents the product as an irresistible solution. {{instructions}} Begin by formulating an 6-8 sentence compelling narrative outline that clearly and provocatively communicates the problem and solution. Break this narrative into concise, powerful single-word or short-phrase notes to enhance clarity and emotional impact. Use suspense, stakes, and surprise storytelling techniques to heighten the narrative. Only after these notes are crafted, use the respond function to deliver them sequentially as dynamic, persuasive elements. Each pitch deck must: Clearly highlight the problem being solved. Provocatively detail the problem addressed. Powerfully illustrate how the product resolves this problem. Mirror the investor or stakeholder journey, preempting objections through strategic sequencing of notes. All notes must follow these specific rules: Single words or short impactful phrases. Emojis placed in their own notes within the 'description' parameter, with font sizes >50, and opacity/borderOpacity set to .01. Provide imageSearch parameters selectively: Descriptions limited to 5 words or less. Highly specific and relevant search terms. Appropriately estimated sizing relative to other notes. Opacity and borderOpacity at .01. Animations restricted to fadeSlideUp and fadeSlideIn for images. Filter always set to 'embossed'. Leverage diverse animations (mystery, fadeSlideUp, fadeSlideDown, bumpUpIn, bumpDownIn, impactSlide, powerSmash, torqueWarp, smoke, fractured, flux, springy). {{technicalInstructions}} Upon initial creation, meticulously review and iterate on the notes and visual layout, specifying noteIds for targeted modifications (using isUpdate) or removals (using deleteNoteIds) until the pitch deck narrative achieves compelling clarity and precision. Address any issues by directing users to the support icon."
          ],
          "defaultTechnicalInstructions": "Use varied fonts (Bangers, Graduate, IBM Plex Mono, Roboto Condensed, Nixie One, Caveat, Courier Prime, Indie Flower, Lemon, Permanent Marker). Given a {{baseColor}} background color, use a sophisticated color palette based on the color wheel principles: Either choose an analogous scheme (3-4 adjacent colors) creating smooth transitions between thoughts, or select a perfect triadic scheme using muted, sophisticated tones (reduce saturation to 60-70%). Each thought's supporting notes should use lighter tints (add 15-20% white) of their parent color. All colors should maintain consistent saturation and brightness levels. Test the full palette together before implementation to ensure visual harmony.",
          "defaultInstructions": "Transform the provided idea into a persuasive marketing narrative that follows conversion optimization principles. Structure the content into 3-5 key marketing segments that mirror the buyer's journey from problem awareness to solution adoption. Each segment must include 1-2 'noun' notes that capture essential value propositions or market insights, animated with either 'breathe' or 'rotate' to emphasize conversion triggers. Use rotationAngle to mark critical decision points in the customer journey. Each segment should clearly articulate both a market pain point and its corresponding solution, with persuasive language that builds emotional resonance while driving toward clear calls to action.",
          "postProcessing": {
            "scenarios": [
              {
                "type": "checkJSON",
                "params": [
                  "notes"
                ],
                "prompt": "You sent the following parameters as strings, but they need to be JSON: {invalidJSON}",
                "delayInSeconds": 1
              }
            ]
          }
        }
      }
    }
  }
]
