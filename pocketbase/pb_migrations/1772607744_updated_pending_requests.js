/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3794380017")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "from = @request.auth.email || to = @request.auth.email",
    "listRule": "from = @request.auth.email || to = @request.auth.email",
    "updateRule": "from = @request.auth.email || to = @request.auth.email",
    "viewRule": "from = @request.auth.email || to = @request.auth.email"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3794380017")

  // update collection data
  unmarshal({
    "createRule": "",
    "deleteRule": "",
    "listRule": "",
    "updateRule": "",
    "viewRule": ""
  }, collection)

  return app.save(collection)
})
