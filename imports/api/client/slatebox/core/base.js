const availablePlugins = {};

export default class base {

  constructor(initPayload) {
    //register any plugins
    if (this.constructor.name !== "plugin") {
      this.registerPlugins(initPayload);
    }
  }

  registerPlugins(initPayload) {
    let root = this.constructor.name;
    //console.log("registering plugins ", root, base.plugins, base.plugins[root]);
    availablePlugins[root] && availablePlugins[root].forEach(p => {
      const { name, plugin } = p;
      if (!this.plugins) { this.plugins = {}; }
      this.plugins[name] = new plugin(initPayload);
      console.log("set up plugin ", this.plugins[name]);
    });
  }

  static registerPlugin(details) {
    if (!details.name || !details.plugin) {
      throw new Error("Plugins must provide a name and a plugin (class definition)");
    }
    let root = Object.getPrototypeOf(details.plugin).name;
    //console.log("creating plugin root ", root);
    if (!availablePlugins[root]) { availablePlugins[root] = []; }
    availablePlugins[root] = [...availablePlugins[root], details];
  }

}