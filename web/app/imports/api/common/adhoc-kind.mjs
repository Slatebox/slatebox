// The note actions in Ask Slatebox ("More notes like it", "Add ideas under it") start an agent
// conversation with this definition when the slate has none yet. It is code, so it is there on
// every slate without a subscription.
const ADHOC_KIND = Object.freeze({
  "_id": "adhoc",
  "name": "AdHoc",
  "details": "",
  "isAdhoc": true,
  "gather": {
    "items": [
      {
        "key": "discussion"
      },
      {
        "key": "idea",
        "isPrimary": true
      }
    ],
    "onComplete": "populateCenterNode"
  },
  "ai": {
    "decisionTree": {
      "inline": {
        "layoutType": {
          "val": "dot",
          "overlap": "compress",
          "rankdir": "TB"
        },
        "defaultShapes": {
          "category": "circle",
          "note": "stickyNote"
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
                "notes": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string",
                        "description": "What is this note about?"
                      },
                      "id": {
                        "type": "string",
                        "description": "This is a unique 8 character string that you generate."
                      },
                      "styleNodeId": {
                        "type": "string",
                        "description": "Copy the style from this node."
                      }
                    },
                    "required": [
                      "description",
                      "id",
                      "parentCategoryIds"
                    ]
                  }
                },
                "suggestion": {
                  "type": "string",
                  "description": "Explain step-by-step why you generated these notes. This field is required. Keep suggestions to 30 words or less."
                }
              },
              "required": [
                "suggestion"
              ]
            }
          }
        ],
        "prompts": [
          "I'd like to create additional notes about a topic I will specify. Pretend you are an expert in the topic provided and your job is to produce as many notes as I specify in my request. Please keep notes to 20 words or less",
          "Here are the details: {{discussion}}"
        ],
        "useWhenValuesPopulated": [
          "discussion"
        ],
        "voiceId": "alloy",
        "function_call": {
          "name": "respond"
        },
        "sentenceBatchSize": 1
      }
    }
  }
})

/** A fresh copy each call: initAIConversation adds to the prompts it is given. */
export const adhocKind = () => structuredClone(ADHOC_KIND)

export default adhocKind
