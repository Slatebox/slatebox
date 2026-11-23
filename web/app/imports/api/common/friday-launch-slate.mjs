// Shared with the public homepage.
export default {
  "options": {
    "name": "What can still ship on Friday?",
    "containerStyle": {
      "backgroundColor": "#f3f1e4"
    }
  },
  "nodes": [
    {
      "options": {
        "id": "promise",
        "text": "Promised:\nnew billing Friday",
        "xPos": 155,
        "yPos": 0,
        "width": 250,
        "height": 76,
        "backgroundColor": "#efcf84",
        "foregroundColor": "#2d352f",
        "borderColor": "#8d7a45",
        "fontFamily": "Arial, sans-serif",
        "fontSize": 22,
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1
      },
      "relationships": {
        "associations": [
          {
            "id": "promise-checkout",
            "parentId": "promise",
            "childId": "checkout",
            "lineType": "straight",
            "lineColor": "#4f675a",
            "lineWidth": 3,
            "showChildArrow": true
          },
          {
            "id": "promise-migration",
            "parentId": "promise",
            "childId": "migration",
            "lineType": "straight",
            "lineColor": "#4f675a",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "checkout",
        "text": "New checkout page",
        "xPos": 0,
        "yPos": 124,
        "width": 230,
        "height": 76,
        "backgroundColor": "#cfe3d6",
        "foregroundColor": "#223d31",
        "borderColor": "#6f8a7a",
        "fontFamily": "Arial, sans-serif",
        "fontSize": 22,
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1
      },
      "relationships": {
        "associations": [
          {
            "id": "checkout-friday",
            "parentId": "checkout",
            "childId": "friday",
            "lineType": "straight",
            "lineColor": "#4f675a",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "migration",
        "text": "Payment migration",
        "xPos": 330,
        "yPos": 124,
        "width": 230,
        "height": 76,
        "backgroundColor": "#f3c3ad",
        "foregroundColor": "#4a281f",
        "borderColor": "#a9755f",
        "fontFamily": "Arial, sans-serif",
        "fontSize": 22,
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1
      },
      "relationships": {
        "associations": [
          {
            "id": "migration-reader",
            "parentId": "migration",
            "childId": "reader",
            "lineType": "straight",
            "lineColor": "#4f675a",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "friday",
        "text": "Ships Friday",
        "xPos": 0,
        "yPos": 248,
        "width": 230,
        "height": 76,
        "backgroundColor": "#2b4b3c",
        "foregroundColor": "#fffbed",
        "borderColor": "#2b4b3c",
        "fontFamily": "Arial, sans-serif",
        "fontSize": 22,
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1
      },
      "relationships": {
        "associations": [
          {
            "id": "friday-tell",
            "parentId": "friday",
            "childId": "tell",
            "lineType": "straight",
            "lineColor": "#4f675a",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "reader",
        "text": "Second engineer\nreads it first",
        "xPos": 330,
        "yPos": 248,
        "width": 230,
        "height": 76,
        "backgroundColor": "#f8dbca",
        "foregroundColor": "#4a281f",
        "borderColor": "#a9755f",
        "fontFamily": "Arial, sans-serif",
        "fontSize": 22,
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1
      },
      "relationships": {
        "associations": [
          {
            "id": "reader-monday",
            "parentId": "reader",
            "childId": "monday",
            "lineType": "straight",
            "lineColor": "#4f675a",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "monday",
        "text": "Ships Monday",
        "xPos": 330,
        "yPos": 372,
        "width": 230,
        "height": 76,
        "backgroundColor": "#8a4a32",
        "foregroundColor": "#fff6ea",
        "borderColor": "#8a4a32",
        "fontFamily": "Arial, sans-serif",
        "fontSize": 22,
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1
      },
      "relationships": {
        "associations": [
          {
            "id": "monday-tell",
            "parentId": "monday",
            "childId": "tell",
            "lineType": "straight",
            "lineColor": "#4f675a",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "tell",
        "text": "Tell customers: new checkout Friday.\nBilling moves over Monday.",
        "xPos": 30,
        "yPos": 496,
        "width": 500,
        "height": 84,
        "backgroundColor": "#fffdf4",
        "foregroundColor": "#21392f",
        "borderColor": "#21392f",
        "fontFamily": "Arial, sans-serif",
        "fontSize": 22,
        "textXAlign": "center",
        "shapeHint": "rectangle",
        "borderWidth": 1
      },
      "relationships": {
        "associations": []
      }
    }
  ]
}
