// The public intelligence example opens this same native drawing.
export default {
  "options": {
    "name": "What happened to video calls?",
    "containerStyle": {
      "backgroundColor": "#eaf0e6"
    }
  },
  "nodes": [
    {
      "options": {
        "id": "call",
        "text": "Video call",
        "xPos": 132,
        "yPos": 0,
        "width": 205,
        "height": 66,
        "backgroundColor": "#294838",
        "foregroundColor": "#fffaf0",
        "fontSize": 21,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1,
        "borderColor": "#577160"
      },
      "relationships": {
        "associations": [
          {
            "id": "call-new-session",
            "parentId": "call",
            "childId": "new-session",
            "lineType": "straight",
            "lineColor": "#46614e",
            "lineWidth": 3,
            "showChildArrow": true
          },
          {
            "id": "call-existing-session",
            "parentId": "call",
            "childId": "existing-session",
            "lineType": "straight",
            "lineColor": "#46614e",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "new-session",
        "text": "New session",
        "xPos": 6,
        "yPos": 103,
        "width": 205,
        "height": 66,
        "backgroundColor": "#f3d99c",
        "foregroundColor": "#26382d",
        "fontSize": 21,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1,
        "borderColor": "#577160"
      },
      "relationships": {
        "associations": [
          {
            "id": "new-session-unavailable",
            "parentId": "new-session",
            "childId": "unavailable",
            "lineType": "straight",
            "lineColor": "#46614e",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "existing-session",
        "text": "Existing session",
        "xPos": 258,
        "yPos": 103,
        "width": 205,
        "height": 66,
        "backgroundColor": "#cde2d6",
        "foregroundColor": "#26382d",
        "fontSize": 21,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1,
        "borderColor": "#577160"
      },
      "relationships": {
        "associations": [
          {
            "id": "existing-session-maintained",
            "parentId": "existing-session",
            "childId": "maintained",
            "lineType": "straight",
            "lineColor": "#46614e",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "unavailable",
        "text": "Could not start",
        "xPos": 6,
        "yPos": 212,
        "width": 205,
        "height": 66,
        "backgroundColor": "#eac0af",
        "foregroundColor": "#26382d",
        "fontSize": 21,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1,
        "borderColor": "#577160"
      },
      "relationships": {
        "associations": []
      }
    },
    {
      "options": {
        "id": "maintained",
        "text": "Stayed connected",
        "xPos": 258,
        "yPos": 212,
        "width": 205,
        "height": 66,
        "backgroundColor": "#b7dbc5",
        "foregroundColor": "#26382d",
        "fontSize": 21,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle",
        "borderWidth": 1,
        "borderColor": "#577160"
      },
      "relationships": {
        "associations": []
      }
    }
  ]
}
