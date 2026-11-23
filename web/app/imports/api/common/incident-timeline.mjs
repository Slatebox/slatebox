import { readNativeNotesFragment } from './native-notes-fragment.mjs'

// The four notes and their links from the public collaboration demo.
export const incidentTimeline = {
  "options": {
    "name": "02:26 \u00b7 On-call handoff"
  },
  "shareId": "",
  "nodes": [
    {
      "options": {
        "id": "trace",
        "text": "02:12  /  Gateway timeouts",
        "xPos": 0,
        "yPos": 0,
        "width": 228,
        "height": 96,
        "shapeHint": "rectangle",
        "backgroundColor": "#f6cd87",
        "foregroundColor": "#26382f",
        "fontSize": 23,
        "borderWidth": 1,
        "borderColor": "#809286"
      },
      "relationships": {
        "associations": [
          {
            "id": "trace-retries",
            "parentId": "trace",
            "childId": "retries",
            "lineType": "straight",
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "retries",
        "text": "02:19  /  Retry traffic doubles",
        "xPos": 290,
        "yPos": 0,
        "width": 228,
        "height": 96,
        "shapeHint": "rectangle",
        "backgroundColor": "#f1b29f",
        "foregroundColor": "#26382f",
        "fontSize": 23,
        "borderWidth": 1,
        "borderColor": "#809286"
      },
      "relationships": {
        "associations": [
          {
            "id": "retries-recovery",
            "parentId": "retries",
            "childId": "recovery",
            "lineType": "straight",
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "recovery",
        "text": "02:26  /  Queue drains",
        "xPos": 570,
        "yPos": 0,
        "width": 228,
        "height": 96,
        "shapeHint": "rectangle",
        "backgroundColor": "#bcd4c5",
        "foregroundColor": "#26382f",
        "fontSize": 23,
        "borderWidth": 1,
        "borderColor": "#809286"
      },
      "relationships": {
        "associations": [
          {
            "id": "recovery-handoff",
            "parentId": "recovery",
            "childId": "handoff",
            "lineType": "straight",
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "handoff",
        "text": "Who owns the retry limit?",
        "xPos": 290,
        "yPos": 188,
        "width": 228,
        "height": 96,
        "shapeHint": "rectangle",
        "backgroundColor": "#f8df84",
        "foregroundColor": "#26382f",
        "fontSize": 23,
        "borderWidth": 1,
        "borderColor": "#809286"
      },
      "relationships": {
        "associations": []
      }
    }
  ]
}

export { maxNativeNotesFragmentLength as maxIncidentFragmentLength } from './native-notes-fragment.mjs'
export const readIncidentFragment = fragment => readNativeNotesFragment(incidentTimeline, fragment)
