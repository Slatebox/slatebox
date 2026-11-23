// Shared with the public sign-in outage whiteboard.
export default {
  "options": {
    "name": "What still works when sign-in goes down?",
    "containerStyle": {
      "backgroundColor": "#f7f4e8"
    }
  },
  "nodes": [
    {
      "options": {
        "id": "newcomer",
        "text": "New customer",
        "xPos": 22,
        "yPos": 20,
        "width": 192,
        "height": 76,
        "backgroundColor": "#efcf84",
        "foregroundColor": "#2d352f",
        "fontSize": 22,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "rectangle",
        "borderWidth": 1,
        "borderColor": "#697565"
      },
      "relationships": {
        "associations": [
          {
            "id": "newcomer-signin",
            "parentId": "newcomer",
            "childId": "signin",
            "lineType": "straight",
            "lineColor": "#496052",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "signin",
        "text": "Sign in\nUnavailable",
        "xPos": 280,
        "yPos": 12,
        "width": 192,
        "height": 76,
        "backgroundColor": "#f0b29c",
        "foregroundColor": "#4a281f",
        "fontSize": 22,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "rectangle",
        "borderWidth": 1,
        "borderColor": "#697565"
      },
      "relationships": {
        "associations": [
          {
            "id": "signin-blocked",
            "parentId": "signin",
            "childId": "blocked",
            "lineType": "straight",
            "lineColor": "#496052",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "blocked",
        "text": "Can’t open\na workspace",
        "xPos": 275,
        "yPos": 138,
        "width": 192,
        "height": 76,
        "backgroundColor": "#f8dbca",
        "foregroundColor": "#482f24",
        "fontSize": 22,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "rectangle",
        "borderWidth": 1,
        "borderColor": "#697565"
      },
      "relationships": {
        "associations": [
          {
            "id": "blocked-fallback",
            "parentId": "blocked",
            "childId": "fallback",
            "lineType": "straight",
            "lineColor": "#496052",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "fallback",
        "text": "Support sends\na status link",
        "xPos": 30,
        "yPos": 151,
        "width": 192,
        "height": 76,
        "backgroundColor": "#f5e5b8",
        "foregroundColor": "#33372c",
        "fontSize": 22,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "rectangle",
        "borderWidth": 1,
        "borderColor": "#697565"
      },
      "relationships": {
        "associations": []
      }
    },
    {
      "options": {
        "id": "session",
        "text": "Existing session",
        "xPos": 22,
        "yPos": 296,
        "width": 192,
        "height": 76,
        "backgroundColor": "#cadaaa",
        "foregroundColor": "#203d31",
        "fontSize": 22,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "rectangle",
        "borderWidth": 1,
        "borderColor": "#697565"
      },
      "relationships": {
        "associations": [
          {
            "id": "session-workspace",
            "parentId": "session",
            "childId": "workspace",
            "lineType": "straight",
            "lineColor": "#496052",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "workspace",
        "text": "Open saved work",
        "xPos": 281,
        "yPos": 292,
        "width": 192,
        "height": 76,
        "backgroundColor": "#315645",
        "foregroundColor": "#fff9e7",
        "fontSize": 22,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "rectangle",
        "borderWidth": 1,
        "borderColor": "#697565"
      },
      "relationships": {
        "associations": []
      }
    }
  ]
}
