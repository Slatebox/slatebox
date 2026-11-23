// Mirrors the three stops in the public Presentations rehearsal.
export default {
  "options": {
    "name": "A river in three rooms",
    "containerStyle": {
      "backgroundColor": "#f4f2e7"
    }
  },
  "shareId": "",
  "nodes": [
    {
      "options": {
        "id": "listening-post",
        "text": "Listening post\nHear the river under the stone bridge.",
        "xPos": 0,
        "yPos": 0,
        "width": 320,
        "height": 150,
        "shapeHint": "roundedRectangle",
        "backgroundColor": "#ffde87",
        "foregroundColor": "#24352e",
        "fontSize": 24
      },
      "relationships": {
        "associations": [
          {
            "id": "listening-post-flood-marks",
            "parentId": "listening-post",
            "childId": "flood-marks",
            "lineType": "straight",
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "flood-marks",
        "text": "Flood marks\nTrace the high-water line along the wall.",
        "xPos": 390,
        "yPos": 55,
        "width": 320,
        "height": 150,
        "shapeHint": "rectangle",
        "backgroundColor": "#f1bfaa",
        "foregroundColor": "#24352e",
        "fontSize": 24
      },
      "relationships": {
        "associations": [
          {
            "id": "flood-marks-sketchbook",
            "parentId": "flood-marks",
            "childId": "sketchbook",
            "lineType": "straight",
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "sketchbook",
        "text": "Visitor sketchbook\nDraw the bend you remember.",
        "xPos": 560,
        "yPos": 320,
        "width": 320,
        "height": 150,
        "shapeHint": "roundedRectangle",
        "backgroundColor": "#bbd7d4",
        "foregroundColor": "#24352e",
        "fontSize": 24
      },
      "relationships": {
        "associations": []
      }
    }
  ]
}
