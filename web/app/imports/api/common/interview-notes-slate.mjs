// Shared with the public research synthesis example.
export default {
  "options": {
    "name": "What makes the first import feel risky?",
    "containerStyle": {
      "backgroundColor": "#eeeee3"
    }
  },
  "nodes": [
    {
      "options": {
        "id": "sample",
        "text": "“Can I try a sample file first?”",
        "xPos": 12,
        "yPos": 10,
        "width": 236,
        "height": 92,
        "backgroundColor": "#f0d399",
        "foregroundColor": "#24372d",
        "borderColor": "#627569",
        "borderWidth": 1,
        "fontSize": 19,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle"
      },
      "relationships": {
        "associations": [
          {
            "id": "sample-risk",
            "parentId": "sample",
            "childId": "risk",
            "lineType": "straight",
            "lineColor": "#596e60",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "undo",
        "text": "“Can I undo the import?”",
        "xPos": 284,
        "yPos": 10,
        "width": 236,
        "height": 92,
        "backgroundColor": "#d9d3e5",
        "foregroundColor": "#342f41",
        "borderColor": "#627569",
        "borderWidth": 1,
        "fontSize": 19,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle"
      },
      "relationships": {
        "associations": [
          {
            "id": "undo-risk",
            "parentId": "undo",
            "childId": "risk",
            "lineType": "straight",
            "lineColor": "#596e60",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "risk",
        "text": "Trying an import feels risky",
        "xPos": 138,
        "yPos": 164,
        "width": 256,
        "height": 76,
        "backgroundColor": "#2b4b3c",
        "foregroundColor": "#fffbed",
        "borderColor": "#627569",
        "borderWidth": 1,
        "fontSize": 19,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle"
      },
      "relationships": {
        "associations": [
          {
            "id": "risk-test",
            "parentId": "risk",
            "childId": "test",
            "lineType": "straight",
            "lineColor": "#596e60",
            "lineWidth": 3,
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "test",
        "text": "Test a reversible preview",
        "xPos": 138,
        "yPos": 295,
        "width": 256,
        "height": 76,
        "backgroundColor": "#c9ded0",
        "foregroundColor": "#223d31",
        "borderColor": "#627569",
        "borderWidth": 1,
        "fontSize": 19,
        "fontFamily": "Arial, sans-serif",
        "textXAlign": "center",
        "shapeHint": "roundedRectangle"
      },
      "relationships": {
        "associations": []
      }
    }
  ]
}
