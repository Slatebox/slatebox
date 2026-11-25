// The six presentations Slatebox built for the Presentations page, as library items (server/library/showcase.mjs).
// Written by the site's scripts/make-present-decks.mjs (--app): change them there, not here.
export const showcasePresentations = [
 {
  "slug": "launch-war-room",
  "title": "Launch day war room",
  "summary": "A launch, live: the countdown, the signals, the owners and the risks, in Neon. An example built by Slatebox.",
  "slate": {
   "options": {
    "name": "Launch day war room",
    "containerStyle": {
     "backgroundColor": "#f3f1e4"
    }
   },
   "nodes": [
    {
     "options": {
      "id": "launch",
      "text": "Launch day:\nversion 2 goes live",
      "xPos": 0,
      "yPos": 205,
      "width": 300,
      "height": 160,
      "backgroundColor": "#f2d27c",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 30,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "launch-countdown",
        "parentId": "launch",
        "childId": "countdown"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "launch-signals",
        "parentId": "launch",
        "childId": "signals"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "launch-owners",
        "parentId": "launch",
        "childId": "owners"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "launch-risks",
        "parentId": "launch",
        "childId": "risks"
       }
      ]
     }
    },
    {
     "options": {
      "id": "countdown",
      "text": "The countdown",
      "xPos": 400,
      "yPos": 0,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "countdown-golive",
        "parentId": "countdown",
        "childId": "golive"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "countdown-announce",
        "parentId": "countdown",
        "childId": "announce"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "countdown-firstcall",
        "parentId": "countdown",
        "childId": "firstcall"
       }
      ]
     }
    },
    {
     "options": {
      "id": "golive",
      "text": "09:00\nGo live",
      "xPos": 720,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "announce",
      "text": "09:15\nPost the announcement",
      "xPos": 1010,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "firstcall",
      "text": "10:00\nFirst customer call",
      "xPos": 1300,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "signals",
      "text": "The signals",
      "xPos": 400,
      "yPos": 150,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "signals-signups",
        "parentId": "signals",
        "childId": "signups"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "signals-errors",
        "parentId": "signals",
        "childId": "errors"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "signals-replies",
        "parentId": "signals",
        "childId": "replies"
       }
      ]
     }
    },
    {
     "options": {
      "id": "signups",
      "text": "4,812 sign-ups\nin 24 hours",
      "xPos": 720,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "errors",
      "text": "Error rate\n0.4%",
      "xPos": 1010,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "replies",
      "text": "Support replies\nunder 2 hours",
      "xPos": 1300,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "owners",
      "text": "Who owns what",
      "xPos": 400,
      "yPos": 300,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "owners-release",
        "parentId": "owners",
        "childId": "release"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "owners-oncall",
        "parentId": "owners",
        "childId": "oncall"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "owners-support",
        "parentId": "owners",
        "childId": "support"
       }
      ]
     }
    },
    {
     "options": {
      "id": "release",
      "text": "Mara:\nthe release",
      "xPos": 720,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "oncall",
      "text": "Dev:\non call",
      "xPos": 1010,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "support",
      "text": "Ines:\nsupport",
      "xPos": 1300,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "risks",
      "text": "What could break",
      "xPos": 400,
      "yPos": 450,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "risks-load",
        "parentId": "risks",
        "childId": "load"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "risks-imports",
        "parentId": "risks",
        "childId": "imports"
       }
      ]
     }
    },
    {
     "options": {
      "id": "load",
      "text": "Checkout\nunder load",
      "xPos": 720,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "imports",
      "text": "Large file\nimports",
      "xPos": 1010,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    }
   ]
  },
  "look": {
   "style": "neon",
   "direction": {
    "title": "Launch day war room",
    "kicker": "Version 2 · live",
    "subtitle": "One slate the whole team watches from 09:00.",
    "steps": [
     {
      "layout": "overview",
      "nodeIds": [
       "launch",
       "countdown",
       "signals",
       "owners",
       "risks"
      ],
      "kicker": "T minus 0",
      "caption": "Everything we watch today is on one slate."
     },
     {
      "layout": "trace",
      "nodeIds": [
       "countdown",
       "golive",
       "announce",
       "firstcall"
      ],
      "headline": "Live at 09:00",
      "kicker": "The countdown",
      "caption": "Live at nine, the post at quarter past, a customer by ten."
     },
     {
      "layout": "bigNumber",
      "nodeIds": [
       "signals",
       "signups"
      ],
      "number": "4,812",
      "numberLabel": "sign-ups in the first 24 hours",
      "kicker": "The signal",
      "caption": "The number the whole room is watching."
     },
     {
      "layout": "group",
      "nodeIds": [
       "signals",
       "errors",
       "replies"
      ],
      "headline": "Still healthy",
      "kicker": "Still healthy",
      "caption": "Errors stay low and support keeps up."
     },
     {
      "layout": "treeBuild",
      "nodeIds": [
       "owners",
       "release",
       "oncall",
       "support"
      ],
      "headline": "Who owns what",
      "kicker": "Owners",
      "caption": "One name on every part of the day."
     },
     {
      "layout": "hero",
      "nodeIds": [
       "risks",
       "load",
       "imports"
      ],
      "headline": "What could break",
      "kicker": "Eyes open",
      "caption": "Two things could still break. Both have an owner."
     }
    ],
    "closing": "Every number here is a note the team updates.",
    "cta": "Open the war room"
   }
  }
 },
 {
  "slug": "checkout-postmortem",
  "title": "The 41-minute checkout outage",
  "summary": "An incident review that replays the timeline minute by minute, in Blueprint. An example built by Slatebox.",
  "slate": {
   "options": {
    "name": "The 41-minute checkout outage",
    "containerStyle": {
     "backgroundColor": "#f3f1e4"
    }
   },
   "nodes": [
    {
     "options": {
      "id": "outage",
      "text": "Checkout outage,\n14 March",
      "xPos": 0,
      "yPos": 205,
      "width": 300,
      "height": 160,
      "backgroundColor": "#f2d27c",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 30,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "outage-timeline",
        "parentId": "outage",
        "childId": "timeline"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "outage-cause",
        "parentId": "outage",
        "childId": "cause"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "outage-held",
        "parentId": "outage",
        "childId": "held"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "outage-changes",
        "parentId": "outage",
        "childId": "changes"
       }
      ]
     }
    },
    {
     "options": {
      "id": "timeline",
      "text": "The timeline",
      "xPos": 400,
      "yPos": 0,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "timeline-deploy",
        "parentId": "timeline",
        "childId": "deploy"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "timeline-spike",
        "parentId": "timeline",
        "childId": "spike"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "timeline-rollback",
        "parentId": "timeline",
        "childId": "rollback"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "timeline-recovered",
        "parentId": "timeline",
        "childId": "recovered"
       }
      ]
     }
    },
    {
     "options": {
      "id": "deploy",
      "text": "14:02\nDeploy 418 goes out",
      "xPos": 720,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "spike",
      "text": "14:09\nPayment errors spike",
      "xPos": 1010,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "rollback",
      "text": "14:31\nRollback starts",
      "xPos": 1300,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "recovered",
      "text": "14:43\nCheckout recovers",
      "xPos": 1590,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "cause",
      "text": "Why it broke",
      "xPos": 400,
      "yPos": 150,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "cause-retry",
        "parentId": "cause",
        "childId": "retry"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "cause-noalert",
        "parentId": "cause",
        "childId": "noalert"
       }
      ]
     }
    },
    {
     "options": {
      "id": "retry",
      "text": "A retry loop\ndoubled the load",
      "xPos": 720,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "noalert",
      "text": "No alert on\npayment errors",
      "xPos": 1010,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "held",
      "text": "What held",
      "xPos": 400,
      "yPos": 300,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "held-carts",
        "parentId": "held",
        "childId": "carts"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "held-status",
        "parentId": "held",
        "childId": "status"
       }
      ]
     }
    },
    {
     "options": {
      "id": "carts",
      "text": "Every cart\nwas saved",
      "xPos": 720,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "status",
      "text": "Status page\nupdated in 6 minutes",
      "xPos": 1010,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "changes",
      "text": "What changes",
      "xPos": 400,
      "yPos": 450,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "changes-alert",
        "parentId": "changes",
        "childId": "alert"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "changes-canary",
        "parentId": "changes",
        "childId": "canary"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "changes-minutes",
        "parentId": "changes",
        "childId": "minutes"
       }
      ]
     }
    },
    {
     "options": {
      "id": "alert",
      "text": "Alert on\npayment errors",
      "xPos": 720,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "canary",
      "text": "A canary for\nevery deploy",
      "xPos": 1010,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "minutes",
      "text": "41 minutes,\nnever again",
      "xPos": 1300,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    }
   ]
  },
  "look": {
   "style": "blueprint",
   "direction": {
    "title": "The 41-minute checkout outage",
    "kicker": "Incident review · 14 March",
    "subtitle": "What broke, what held and what we change.",
    "steps": [
     {
      "layout": "overview",
      "nodeIds": [
       "outage",
       "timeline",
       "cause",
       "held",
       "changes"
      ],
      "kicker": "Fig. 1",
      "caption": "The whole incident on one sheet."
     },
     {
      "layout": "bigNumber",
      "nodeIds": [
       "changes",
       "minutes"
      ],
      "number": "41",
      "numberLabel": "minutes of failed checkouts",
      "kicker": "Impact",
      "caption": "From the deploy to the last failed payment."
     },
     {
      "layout": "trace",
      "nodeIds": [
       "timeline",
       "deploy",
       "spike",
       "rollback",
       "recovered"
      ],
      "headline": "14:02 to 14:43",
      "kicker": "Replay",
      "caption": "Minute by minute, from the deploy to recovery."
     },
     {
      "layout": "compare",
      "nodeIds": [
       "cause",
       "retry",
       "noalert",
       "held",
       "carts",
       "status"
      ],
      "headlines": [
       "Why it broke",
       "What held"
      ],
      "kicker": "Cause and cover",
      "caption": "A loop doubled the load. The carts survived it."
     },
     {
      "layout": "treeBuild",
      "nodeIds": [
       "changes",
       "alert",
       "canary"
      ],
      "headline": "What changes",
      "kicker": "Actions",
      "caption": "Two changes, each with an owner and a date."
     }
    ],
    "closing": "The timeline stays on the slate for the next review.",
    "cta": "Open the review"
   }
  }
 },
 {
  "slug": "investor-update",
  "title": "Q3 investor update",
  "summary": "A quarterly update with the runway as the headline, in Editorial. An example built by Slatebox.",
  "slate": {
   "options": {
    "name": "Q3 investor update",
    "containerStyle": {
     "backgroundColor": "#f3f1e4"
    }
   },
   "nodes": [
    {
     "options": {
      "id": "quarter",
      "text": "Q3 at a glance",
      "xPos": 0,
      "yPos": 280,
      "width": 300,
      "height": 160,
      "backgroundColor": "#f2d27c",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 30,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "quarter-growth",
        "parentId": "quarter",
        "childId": "growth"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "quarter-runway",
        "parentId": "quarter",
        "childId": "runway"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "quarter-team",
        "parentId": "quarter",
        "childId": "team"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "quarter-voice",
        "parentId": "quarter",
        "childId": "voice"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "quarter-ask",
        "parentId": "quarter",
        "childId": "ask"
       }
      ]
     }
    },
    {
     "options": {
      "id": "growth",
      "text": "Growth",
      "xPos": 400,
      "yPos": 0,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "growth-mrr",
        "parentId": "growth",
        "childId": "mrr"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "growth-teams",
        "parentId": "growth",
        "childId": "teams"
       }
      ]
     }
    },
    {
     "options": {
      "id": "mrr",
      "text": "Revenue $84k a month,\nup 18%",
      "xPos": 720,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "teams",
      "text": "312 paying teams",
      "xPos": 1010,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "runway",
      "text": "Runway",
      "xPos": 400,
      "yPos": 150,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "runway-months",
        "parentId": "runway",
        "childId": "months"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "runway-burn",
        "parentId": "runway",
        "childId": "burn"
       }
      ]
     }
    },
    {
     "options": {
      "id": "months",
      "text": "19 months\nof runway",
      "xPos": 720,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "burn",
      "text": "Burn $96k\na month",
      "xPos": 1010,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "team",
      "text": "Team",
      "xPos": 400,
      "yPos": 300,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "team-hires",
        "parentId": "team",
        "childId": "hires"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "team-support",
        "parentId": "team",
        "childId": "support"
       }
      ]
     }
    },
    {
     "options": {
      "id": "hires",
      "text": "Two engineers\nhired",
      "xPos": 720,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "support",
      "text": "Head of support\nstarts in October",
      "xPos": 1010,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "voice",
      "text": "From a pilot team",
      "xPos": 400,
      "yPos": 450,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "voice-quote",
        "parentId": "voice",
        "childId": "quote"
       }
      ]
     }
    },
    {
     "options": {
      "id": "quote",
      "text": "“Three docs retired in a week.”",
      "xPos": 720,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "ask",
      "text": "Our ask",
      "xPos": 400,
      "yPos": 600,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "ask-intros",
        "parentId": "ask",
        "childId": "intros"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "ask-cfo",
        "parentId": "ask",
        "childId": "cfo"
       }
      ]
     }
    },
    {
     "options": {
      "id": "intros",
      "text": "Intros to two\ndesign partners",
      "xPos": 720,
      "yPos": 605,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "cfo",
      "text": "A finance lead\none day a month",
      "xPos": 1010,
      "yPos": 605,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    }
   ]
  },
  "look": {
   "style": "editorial",
   "direction": {
    "title": "Q3 investor update",
    "kicker": "The quarterly issue",
    "subtitle": "Growth, runway, the team and one ask.",
    "steps": [
     {
      "layout": "overview",
      "nodeIds": [
       "quarter",
       "growth",
       "runway",
       "team",
       "voice",
       "ask"
      ],
      "kicker": "In this issue",
      "caption": "Five stories from one quarter."
     },
     {
      "layout": "bigNumber",
      "nodeIds": [
       "runway",
       "months",
       "burn"
      ],
      "number": "19",
      "numberLabel": "months of runway",
      "kicker": "The headline",
      "caption": "At today’s burn, with no new money."
     },
     {
      "layout": "split",
      "nodeIds": [
       "growth",
       "mrr",
       "teams"
      ],
      "headline": "Growth",
      "kicker": "Growth",
      "caption": "Up eighteen percent, three hundred and twelve teams."
     },
     {
      "layout": "quote",
      "nodeIds": [
       "voice",
       "quote"
      ],
      "quote": "Three docs retired in a week.",
      "kicker": "In their words",
      "caption": "A pilot team, in week two."
     },
     {
      "layout": "group",
      "nodeIds": [
       "team",
       "hires",
       "support"
      ],
      "headline": "The team",
      "kicker": "The team",
      "caption": "Two engineers in, support lead from October."
     },
     {
      "layout": "hero",
      "nodeIds": [
       "ask",
       "intros",
       "cfo"
      ],
      "headline": "Our ask",
      "kicker": "The ask",
      "caption": "Two introductions and a day a month."
     }
    ],
    "closing": "Reply on the slate: every figure is a note.",
    "cta": "Open the update"
   }
  }
 },
 {
  "slug": "trial-research",
  "title": "Why trials stall: 212 answers",
  "summary": "A research readout built from survey piles, in Sketchbook. An example built by Slatebox.",
  "slate": {
   "options": {
    "name": "Why trials stall",
    "containerStyle": {
     "backgroundColor": "#f3f1e4"
    }
   },
   "nodes": [
    {
     "options": {
      "id": "question",
      "text": "Why do trials stall?\n212 answers",
      "xPos": 0,
      "yPos": 205,
      "width": 300,
      "height": 160,
      "backgroundColor": "#f2d27c",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 30,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "question-invite",
        "parentId": "question",
        "childId": "invite"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "question-setup",
        "parentId": "question",
        "childId": "setup"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "question-value",
        "parentId": "question",
        "childId": "value"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "question-next",
        "parentId": "question",
        "childId": "next"
       }
      ]
     }
    },
    {
     "options": {
      "id": "invite",
      "text": "Can’t find\nthe invite",
      "xPos": 400,
      "yPos": 0,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "invite-inviteq",
        "parentId": "invite",
        "childId": "inviteq"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "invite-invites",
        "parentId": "invite",
        "childId": "invites"
       }
      ]
     }
    },
    {
     "options": {
      "id": "inviteq",
      "text": "“Where do I add my team?”",
      "xPos": 720,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "invites",
      "text": "74 answers",
      "xPos": 1010,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "setup",
      "text": "Setup takes\ntoo long",
      "xPos": 400,
      "yPos": 150,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "setup-setupq",
        "parentId": "setup",
        "childId": "setupq"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "setup-setups",
        "parentId": "setup",
        "childId": "setups"
       }
      ]
     }
    },
    {
     "options": {
      "id": "setupq",
      "text": "“I gave up at the import.”",
      "xPos": 720,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "setups",
      "text": "58 answers",
      "xPos": 1010,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "value",
      "text": "Didn’t see\nthe point yet",
      "xPos": 400,
      "yPos": 300,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "value-valueq",
        "parentId": "value",
        "childId": "valueq"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "value-values",
        "parentId": "value",
        "childId": "values"
       }
      ]
     }
    },
    {
     "options": {
      "id": "valueq",
      "text": "“It looked empty without my data.”",
      "xPos": 720,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "values",
      "text": "41 answers",
      "xPos": 1010,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "next",
      "text": "What we test next",
      "xPos": 400,
      "yPos": 450,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "next-first",
        "parentId": "next",
        "childId": "first"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "next-sample",
        "parentId": "next",
        "childId": "sample"
       }
      ]
     }
    },
    {
     "options": {
      "id": "first",
      "text": "Invite on the\nfirst screen",
      "xPos": 720,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "sample",
      "text": "A sample slate\nat sign-up",
      "xPos": 1010,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    }
   ]
  },
  "look": {
   "style": "sketch",
   "direction": {
    "title": "Why trials stall",
    "kicker": "Survey readout",
    "subtitle": "212 answers, sorted into three piles.",
    "steps": [
     {
      "layout": "overview",
      "nodeIds": [
       "question",
       "invite",
       "setup",
       "value",
       "next"
      ],
      "kicker": "The piles",
      "caption": "Every answer, sorted on one slate."
     },
     {
      "layout": "bigNumber",
      "nodeIds": [
       "question"
      ],
      "number": "212",
      "numberLabel": "answers from stalled trials",
      "kicker": "We asked",
      "caption": "Everyone who stopped in the first week."
     },
     {
      "layout": "quote",
      "nodeIds": [
       "invite",
       "inviteq",
       "invites"
      ],
      "quote": "Where do I add my team?",
      "kicker": "Pile one · 74",
      "caption": "The biggest pile: nobody found the invite."
     },
     {
      "layout": "quote",
      "nodeIds": [
       "setup",
       "setupq",
       "setups"
      ],
      "quote": "I gave up at the import.",
      "kicker": "Pile two · 58",
      "caption": "Setup asked for too much, too soon."
     },
     {
      "layout": "hero",
      "nodeIds": [
       "value",
       "valueq",
       "values"
      ],
      "headline": "It looked empty",
      "kicker": "Pile three · 41",
      "caption": "An empty slate hid what it could do."
     },
     {
      "layout": "treeBuild",
      "nodeIds": [
       "next",
       "first",
       "sample"
      ],
      "headline": "What we test next",
      "kicker": "Next",
      "caption": "Two tests, one for each of the big piles."
     }
    ],
    "closing": "Every quote is still on the slate, in its pile.",
    "cta": "Open the piles"
   }
  }
 },
 {
  "slug": "roadmap-bets",
  "title": "2027: three bets",
  "summary": "A travel app’s roadmap told as three bets, in Voyage. An example built by Slatebox.",
  "slate": {
   "options": {
    "name": "2027: three bets",
    "containerStyle": {
     "backgroundColor": "#f3f1e4"
    }
   },
   "nodes": [
    {
     "options": {
      "id": "year",
      "text": "2027 roadmap",
      "xPos": 0,
      "yPos": 205,
      "width": 300,
      "height": 160,
      "backgroundColor": "#f2d27c",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 30,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "year-offline",
        "parentId": "year",
        "childId": "offline"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "year-groups",
        "parentId": "year",
        "childId": "groups"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "year-carbon",
        "parentId": "year",
        "childId": "carbon"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "year-not",
        "parentId": "year",
        "childId": "not"
       }
      ]
     }
    },
    {
     "options": {
      "id": "offline",
      "text": "Bet 1:\nOffline maps",
      "xPos": 400,
      "yPos": 0,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "offline-o1",
        "parentId": "offline",
        "childId": "o1"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "offline-o2",
        "parentId": "offline",
        "childId": "o2"
       }
      ]
     }
    },
    {
     "options": {
      "id": "o1",
      "text": "Q1: maps that\nwork on a plane",
      "xPos": 720,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "o2",
      "text": "Q2: routes saved\nfor 30 days",
      "xPos": 1010,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "groups",
      "text": "Bet 2:\nGroup trips",
      "xPos": 400,
      "yPos": 150,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "groups-g1",
        "parentId": "groups",
        "childId": "g1"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "groups-g2",
        "parentId": "groups",
        "childId": "g2"
       }
      ]
     }
    },
    {
     "options": {
      "id": "g1",
      "text": "Q2: one plan for\nthe whole group",
      "xPos": 720,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "g2",
      "text": "Q3: split the costs\nin the app",
      "xPos": 1010,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "carbon",
      "text": "Bet 3:\nCarbon receipts",
      "xPos": 400,
      "yPos": 300,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "carbon-c1",
        "parentId": "carbon",
        "childId": "c1"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "carbon-c2",
        "parentId": "carbon",
        "childId": "c2"
       }
      ]
     }
    },
    {
     "options": {
      "id": "c1",
      "text": "Q3: the footprint\nof every booking",
      "xPos": 720,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "c2",
      "text": "Q4: the greener\nroute by default",
      "xPos": 1010,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "not",
      "text": "Not this year",
      "xPos": 400,
      "yPos": 450,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "not-n1",
        "parentId": "not",
        "childId": "n1"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "not-n2",
        "parentId": "not",
        "childId": "n2"
       }
      ]
     }
    },
    {
     "options": {
      "id": "n1",
      "text": "Hotel bookings",
      "xPos": 720,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "n2",
      "text": "A desktop app",
      "xPos": 1010,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    }
   ]
  },
  "look": {
   "style": "voyage",
   "direction": {
    "title": "2027: three bets",
    "kicker": "Roadmap",
    "subtitle": "Where we fly next year, and what we leave behind.",
    "steps": [
     {
      "layout": "overview",
      "nodeIds": [
       "year",
       "offline",
       "groups",
       "carbon",
       "not"
      ],
      "kicker": "The map",
      "caption": "Three bets and one honest no."
     },
     {
      "layout": "dive",
      "nodeIds": [
       "offline",
       "o1",
       "o2"
      ],
      "kicker": "Bet one",
      "caption": "Maps that keep working at thirty thousand feet.",
      "detail": {
       "label": "30",
       "fine": "Routes stay saved for 30 days without signal.",
       "caption": "The detail that sold it."
      }
     },
     {
      "layout": "treeBuild",
      "nodeIds": [
       "groups",
       "g1",
       "g2"
      ],
      "headline": "Group trips",
      "kicker": "Bet two",
      "caption": "One plan for everyone, costs split in the app."
     },
     {
      "layout": "hero",
      "nodeIds": [
       "carbon",
       "c1",
       "c2"
      ],
      "headline": "Carbon receipts",
      "kicker": "Bet three",
      "caption": "Every booking shows its footprint."
     },
     {
      "layout": "group",
      "nodeIds": [
       "not",
       "n1",
       "n2"
      ],
      "headline": "Not this year",
      "kicker": "Not this year",
      "caption": "Saying no keeps the three bets funded."
     }
    ],
    "closing": "Move a bet and the roadmap moves with it.",
    "cta": "Open the roadmap"
   }
  }
 },
 {
  "slug": "first-month",
  "title": "Your first month",
  "summary": "A new teammate’s first 30 days as a route with stops, in Journey. An example built by Slatebox.",
  "slate": {
   "options": {
    "name": "Your first month",
    "containerStyle": {
     "backgroundColor": "#f3f1e4"
    }
   },
   "nodes": [
    {
     "options": {
      "id": "welcome",
      "text": "Welcome aboard:\nyour first 30 days",
      "xPos": 0,
      "yPos": 205,
      "width": 300,
      "height": 160,
      "backgroundColor": "#f2d27c",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 30,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "welcome-week1",
        "parentId": "welcome",
        "childId": "week1"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "welcome-week2",
        "parentId": "welcome",
        "childId": "week2"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "welcome-week3",
        "parentId": "welcome",
        "childId": "week3"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "welcome-week4",
        "parentId": "welcome",
        "childId": "week4"
       }
      ]
     }
    },
    {
     "options": {
      "id": "week1",
      "text": "Week 1:\nmeet the team",
      "xPos": 400,
      "yPos": 0,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week1-buddy",
        "parentId": "week1",
        "childId": "buddy"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week1-tour",
        "parentId": "week1",
        "childId": "tour"
       }
      ]
     }
    },
    {
     "options": {
      "id": "buddy",
      "text": "Lunch with\nyour buddy",
      "xPos": 720,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "tour",
      "text": "A tour of\nthe product",
      "xPos": 1010,
      "yPos": 5,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "week2",
      "text": "Week 2:\nship something small",
      "xPos": 400,
      "yPos": 150,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week2-fix",
        "parentId": "week2",
        "childId": "fix"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week2-demo",
        "parentId": "week2",
        "childId": "demo"
       }
      ]
     }
    },
    {
     "options": {
      "id": "fix",
      "text": "Your first fix,\nreviewed by Dev",
      "xPos": 720,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "demo",
      "text": "Show it at\nFriday demo",
      "xPos": 1010,
      "yPos": 155,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "week3",
      "text": "Week 3:\nsit with customers",
      "xPos": 400,
      "yPos": 300,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week3-calls",
        "parentId": "week3",
        "childId": "calls"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week3-notes",
        "parentId": "week3",
        "childId": "notes"
       }
      ]
     }
    },
    {
     "options": {
      "id": "calls",
      "text": "Join three\ncustomer calls",
      "xPos": 720,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "notes",
      "text": "Share what\nyou heard",
      "xPos": 1010,
      "yPos": 305,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "week4",
      "text": "Week 4:\nown a project",
      "xPos": 400,
      "yPos": 450,
      "width": 250,
      "height": 110,
      "backgroundColor": "#cfe3d6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 24,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": [
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week4-plan",
        "parentId": "week4",
        "childId": "plan"
       },
       {
        "lineType": "straight",
        "lineColor": "#5d6b64",
        "lineWidth": 3,
        "showChildArrow": true,
        "id": "week4-check",
        "parentId": "week4",
        "childId": "check"
       }
      ]
     }
    },
    {
     "options": {
      "id": "plan",
      "text": "Write your\nfirst plan",
      "xPos": 720,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    },
    {
     "options": {
      "id": "check",
      "text": "30-day check-in\nwith Mara",
      "xPos": 1010,
      "yPos": 455,
      "width": 260,
      "height": 100,
      "backgroundColor": "#eef0e6",
      "foregroundColor": "#22302a",
      "borderColor": "#7d8a82",
      "fontFamily": "Arial, sans-serif",
      "fontSize": 20,
      "textXAlign": "center",
      "shapeHint": "roundedRectangle",
      "borderWidth": 1
     },
     "relationships": {
      "associations": []
     }
    }
   ]
  },
  "look": {
   "style": "journey",
   "direction": {
    "title": "Your first month",
    "kicker": "Onboarding",
    "subtitle": "Four weeks, eight stops, one route.",
    "steps": [
     {
      "layout": "overview",
      "nodeIds": [
       "welcome",
       "week1",
       "week2",
       "week3",
       "week4"
      ],
      "kicker": "The route",
      "caption": "Thirty days from hello to your own project."
     },
     {
      "layout": "group",
      "nodeIds": [
       "week1",
       "buddy",
       "tour"
      ],
      "headline": "Meet the team",
      "kicker": "Stop one",
      "caption": "People first: a buddy and a tour."
     },
     {
      "layout": "treeBuild",
      "nodeIds": [
       "week2",
       "fix",
       "demo"
      ],
      "headline": "Ship something small",
      "kicker": "Stop two",
      "caption": "Something small, shipped and shown on Friday."
     },
     {
      "layout": "hero",
      "nodeIds": [
       "week3",
       "calls",
       "notes"
      ],
      "headline": "Sit with customers",
      "kicker": "Stop three",
      "caption": "Hear customers before you build for them."
     },
     {
      "layout": "trace",
      "nodeIds": [
       "week4",
       "plan",
       "check"
      ],
      "headline": "Own a project",
      "kicker": "Stop four",
      "caption": "Your own plan, and a check-in at day thirty."
     }
    ],
    "closing": "Tick a stop off on the slate as you pass it.",
    "cta": "Open the route"
   }
  }
 }
]
