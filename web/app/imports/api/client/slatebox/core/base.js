const availablePlugins = {}

export default class Base {
  constructor(initPayload) {
    // register any plugins
    if (this.constructor.name !== 'plugin') {
      this.registerPlugins(initPayload)
    }
  }

  registerPlugins(initPayload) {
    const root = this.constructor.name
    if (availablePlugins[root]) {
      availablePlugins[root].forEach((p) => {
        const { name, Plugin } = p
        if (!this.Ps) {
          this.plugins = {}
        }
        this.plugins[name] = new Plugin(initPayload)
      })
    }
  }

  static registerPlugin(details) {
    if (!details.name || !details.Plugin) {
      throw new Error(
        'Plugins must provide a name and a plugin (class definition)'
      )
    }
    const root = Object.getPrototypeOf(details.Plugin).name
    if (!availablePlugins[root]) {
      availablePlugins[root] = []
    }
    availablePlugins[root] = [...availablePlugins[root], details]
  }
}
