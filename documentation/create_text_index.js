db.themes.createIndex({ "name": "text", "description": "text" })

db.slates.createIndex({ "options.searchName": "text", "options.searchDescription": "text", "options.searchText": "text" });