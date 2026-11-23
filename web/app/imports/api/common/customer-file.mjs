// Source for the editable copy of the public customer file walkthrough.
export default {
  "options": {
    "name": "Customer file walkthrough",
    "containerStyle": {
      "backgroundColor": "#f7f6ef"
    },
    "description": "A fictional startup shows what happens to an uploaded orders file."
  },
  "shareId": "",
  "nodes": [
    {
      "options": {
        "id": "customer-upload",
        "text": "Customer upload\nSend orders.csv.",
        "xPos": 0,
        "yPos": 0,
        "width": 250,
        "height": 114,
        "shapeHint": "roundedRectangle",
        "backgroundColor": "#f3d48a",
        "foregroundColor": "#182f28",
        "fontSize": 17
      },
      "relationships": {
        "associations": [
          {
            "id": "customer-upload-import-worker",
            "parentId": "customer-upload",
            "childId": "import-worker",
            "lineType": "straight",
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "import-worker",
        "text": "Import worker\nValidate the columns.\nWrite the order rows.",
        "xPos": 295,
        "yPos": 95,
        "width": 250,
        "height": 114,
        "shapeHint": "rectangle",
        "backgroundColor": "#bddadb",
        "foregroundColor": "#182f28",
        "fontSize": 17
      },
      "relationships": {
        "associations": [
          {
            "id": "import-worker-retained-records",
            "parentId": "import-worker",
            "childId": "retained-records",
            "lineType": "straight",
            "showChildArrow": true
          }
        ]
      }
    },
    {
      "options": {
        "id": "retained-records",
        "text": "Retained records\nKeep the rows and receipt.\nDelete the original CSV.",
        "xPos": 590,
        "yPos": 190,
        "width": 250,
        "height": 114,
        "shapeHint": "roundedRectangle",
        "backgroundColor": "#c5d6b6",
        "foregroundColor": "#182f28",
        "fontSize": 17
      },
      "relationships": {
        "associations": []
      }
    }
  ]
}
